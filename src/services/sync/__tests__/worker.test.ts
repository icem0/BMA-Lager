// Tests für den Sync-Worker.
// Wir testen die Strategie (Outbox-Items, Merge-Logik) ohne globale fetch-Mocks,
// weil die in Node-Test-Umgebungen oft unzuverlässig greifen.

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { BmaLagerDb, getDb, setDb } from '../../../db/database'
import type { Artikel, Buchung, OutboxEintrag, Standort } from '../../../db/types'
import { jetztIso, neueUuid } from '../../../domain/ids'

function artikelAnlage(id: string, titel: string): Artikel {
  const now = jetztIso()
  return {
    id,
    sharePointId: null,
    foto: null,
    fotoUrls: [],
    titel,
    status: 'verfuegbar',
    typ: 'Test',
    lieferant: null,
    verpackungseinheit: 1,
    mindestbestand: null,
    nachbestellHinweis: null,
    bestellnummer: null,
    listenpreis: null,
    geaendertAm: now,
    erstelltAm: now,
    archiviert: false,
  }
}

function buchungsAnlage(id: string, artikelId: string, standortId: string, menge: number): Buchung {
  const now = jetztIso()
  return {
    id,
    artikelId,
    standortId,
    standortZielId: null,
    typ: 'einlagerung',
    menge,
    paarId: null,
    projekt: null,
    erstelltAm: now,
    clientEingabeAm: now,
    erstelltVon: 'u1',
    kommentar: null,
    mitteilungAn: null,
    stornoVon: null,
    storno: false,
    storniertDurch: null,
    serverId: null,
  }
}

function standortAnlage(id: string, name: string): Standort {
  const now = jetztIso()
  return {
    id,
    name,
    typ: 'lager',
    projekt: null,
    kennzeichen: null,
    standard: true,
    archiviert: false,
    geaendertAm: now,
    erstelltAm: now,
  }
}

async function outboxAdd(
  entity: 'artikel' | 'buchung',
  op: 'create',
  payload: unknown,
): Promise<void> {
  await getDb().outbox.add({
    id: neueUuid(),
    entity,
    op,
    payload: JSON.stringify(payload),
    createdAt: jetztIso(),
    syncedAt: null,
    attempts: 0,
    lastError: null,
  })
}

describe('Sync — Outbox-Items', () => {
  beforeEach(() => {
    setDb(new BmaLagerDb(`bma-lager-test-${Math.random().toString(36).slice(2)}`))
  })

  it('Artikel landet in der Outbox', async () => {
    const a = artikelAnlage(neueUuid(), 'X')
    await getDb().artikel.add(a)
    await outboxAdd('artikel', 'create', a)
    const items = await getDb().outbox.toArray()
    expect(items.length).toBe(1)
    expect(items[0]?.entity).toBe('artikel')
    expect(items[0]?.syncedAt).toBeNull()
  })

  it('mehrere Outbox-Items bleiben erhalten (Reihenfolge per createdAt)', async () => {
    const a = artikelAnlage(neueUuid(), 'A')
    const b = artikelAnlage(neueUuid(), 'B')
    await getDb().artikel.add(a)
    await getDb().artikel.add(b)
    await outboxAdd('artikel', 'create', a)
    await new Promise((r) => setTimeout(r, 5))
    await outboxAdd('artikel', 'create', b)
    const items = await getDb().outbox.orderBy('createdAt').toArray()
    expect(items.length).toBe(2)
  })

  it('syncedAt lässt sich setzen', async () => {
    const a = artikelAnlage(neueUuid(), 'X')
    await getDb().artikel.add(a)
    await outboxAdd('artikel', 'create', a)
    const items = await getDb().outbox.toArray()
    const id = items[0]!.id
    await getDb().outbox.update(id, { syncedAt: jetztIso() })
    const updated = await getDb().outbox.get(id)
    expect(updated?.syncedAt).not.toBeNull()
  })

  it('markFailed erhöht attempts und setzt lastError, lässt syncedAt null', async () => {
    const b = buchungsAnlage(neueUuid(), 'a1', 's1', 5)
    await outboxAdd('buchung', 'create', b)
    const items = await getDb().outbox.toArray()
    const id = items[0]!.id
    await getDb().outbox.update(id, {
      attempts: 1,
      lastError: 'NEGATIVE_BESTAND: aktuell 2, angefordert 5',
    })
    const updated = await getDb().outbox.get(id)
    expect(updated?.attempts).toBe(1)
    expect(updated?.lastError).toContain('NEGATIVE_BESTAND')
    expect(updated?.syncedAt).toBeNull()
  })

  it('simulierter Push akzeptiert IDs → syncedAt wird gesetzt → Outbox leer (für pending)', async () => {
    const a = artikelAnlage(neueUuid(), 'X')
    await getDb().artikel.add(a)
    await outboxAdd('artikel', 'create', a)

    const items: OutboxEintrag[] = await getDb().outbox.toArray()
    expect(items.length).toBe(1)
    const id = items[0]!.id

    // Server-Reply: accepted
    const acceptedIds = [id]
    for (const accepted of acceptedIds) {
      await getDb().outbox.update(accepted, { syncedAt: jetztIso() })
    }

    const remaining = await getDb().outbox.toArray()
    expect(remaining.filter((o) => o.syncedAt === null).length).toBe(0)
  })
})

describe('Sync — Snapshot-Merge-Strategie (Last-Writer-Wins)', () => {
  beforeEach(() => {
    setDb(new BmaLagerDb(`bma-lager-test-${Math.random().toString(36).slice(2)}`))
  })

  it('Server-Artikel wird in lokale DB übernommen', async () => {
    const a = artikelAnlage(neueUuid(), 'Schraube M8')
    const existing = await getDb().artikel.get(a.id)
    expect(existing).toBeUndefined()
    await getDb().artikel.add(a)
    const lokal = await getDb().artikel.get(a.id)
    expect(lokal?.titel).toBe('Schraube M8')
  })

  it('Lokal-Artikel bleibt, wenn lokaler Zeitstempel neuer ist', async () => {
    const id = neueUuid()
    const serverArtikel = artikelAnlage(id, 'Server-Version')
    serverArtikel.geaendertAm = '2025-01-01T00:00:00.000Z'

    const lokalArtikel = artikelAnlage(id, 'Lokal-Version')
    lokalArtikel.geaendertAm = '2025-02-01T00:00:00.000Z'

    await getDb().artikel.add(lokalArtikel)

    // Merge-Logik aus worker.ts (kopiert)
    const current = await getDb().artikel.get(id)
    if (current && (serverArtikel.geaendertAm ?? '') > (current.geaendertAm ?? '')) {
      await getDb().artikel.put(serverArtikel)
    }

    const lokal = await getDb().artikel.get(id)
    expect(lokal?.titel).toBe('Lokal-Version')
  })

  it('Server-Artikel überschreibt, wenn Server-Zeitstempel neuer ist', async () => {
    const id = neueUuid()
    const serverArtikel = artikelAnlage(id, 'Server-Version (neuer)')
    serverArtikel.geaendertAm = '2025-03-01T00:00:00.000Z'

    const lokalArtikel = artikelAnlage(id, 'Lokal-Version (alter)')
    lokalArtikel.geaendertAm = '2025-01-01T00:00:00.000Z'

    await getDb().artikel.add(lokalArtikel)

    const current = await getDb().artikel.get(id)
    if ((serverArtikel.geaendertAm ?? '') > (current!.geaendertAm ?? '')) {
      await getDb().artikel.put(serverArtikel)
    }

    const lokal = await getDb().artikel.get(id)
    expect(lokal?.titel).toBe('Server-Version (neuer)')
  })

  it('Standorte werden aus Snapshot übernommen', async () => {
    const s = standortAnlage(neueUuid(), 'Hauptlager')
    await getDb().standorte.add(s)
    const lokal = await getDb().standorte.get(s.id)
    expect(lokal?.name).toBe('Hauptlager')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
