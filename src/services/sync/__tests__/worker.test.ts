// Tests für den Sync-Worker.
// Wir testen die Strategie (Outbox-Items, Merge-Logik) ohne globale fetch-Mocks,
// weil die in Node-Test-Umgebungen oft unzuverlässig greifen.

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { BmaLagerDb, getDb, setDb } from '../../../db/database'
import type { Artikel, Buchung, OutboxEintrag, Standort } from '../../../db/types'
import { jetztIso, neueUuid } from '../../../domain/ids'
import { getSyncStatus, type TableCounts } from '../worker'

// Top-Level Worker-Modul-State (`_status`, `_consecutiveFailures`, etc.) wird
// zwischen Tests geteilt. Ohne Reset würden alte Status-Werte in den nächsten
// Test leaken und Assertions scheitern lassen. Wir holen den Reset-Helper
// asynchron, weil der Worker erst beim ersten `await import('../worker')`
// initialisiert wird.
async function resetWorkerState(): Promise<void> {
  const mod = await import('../worker')
  mod._resetSyncForTests()
}

beforeEach(async () => {
  // Frische In-Memory-DB pro Test, damit Outbox/Artikel zwischen Tests nicht
  // leaken. Fake-indexeddb schreibt unter dem übergebenen Namen — jeder neue
  // Name bekommt eine eigene IDBDatabase.
  setDb(new BmaLagerDb(`bma-lager-test-${Math.random().toString(36).slice(2)}`))
  await resetWorkerState()
})

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

describe('Sync — Status & Counts', () => {
  it('SyncStatus hat Felder für Server- und Lokal-Counts', () => {
    const st = getSyncStatus()
    expect(st).toHaveProperty('serverCounts')
    expect(st).toHaveProperty('localCounts')
    expect(st).toHaveProperty('serverTime')
    expect(st.serverCounts).toBeNull()
    expect(st.localCounts).toBeNull()
    expect(st.serverTime).toBeNull()
  })

  it('TableCounts-Form: artikel/standorte/projekte/buchungen', () => {
    const counts: TableCounts = { artikel: 1, standorte: 2, projekte: 3, buchungen: 4 }
    expect(counts.artikel).toBe(1)
    expect(counts.standorte).toBe(2)
    expect(counts.projekte).toBe(3)
    expect(counts.buchungen).toBe(4)
  })

  it('Lokale Counts werden korrekt gezählt', async () => {
    await getDb().artikel.add(artikelAnlage(neueUuid(), 'A'))
    await getDb().artikel.add(artikelAnlage(neueUuid(), 'B'))
    await getDb().standorte.add(standortAnlage(neueUuid(), 'L1'))
    await getDb().buchungen.add(buchungsAnlage(neueUuid(), 'a1', 's1', 5))

    const lokal = {
      artikel: await getDb().artikel.count(),
      standorte: await getDb().standorte.count(),
      projekte: await getDb().projekte.count(),
      buchungen: await getDb().buchungen.count(),
    }
    expect(lokal).toEqual({ artikel: 2, standorte: 1, projekte: 0, buchungen: 1 })
  })
})

describe('Sync — Push-Markierung (Outbox- vs. Payload-IDs)', () => {
  it('akzeptierte Payload-IDs markieren die richtigen Outbox-Items (Outbox-IDs != Payload-IDs)', async () => {
    // Arrange: zwei Artikel in Outbox mit eigenen Outbox-IDs (≠ Domain-UUID).
    const a1 = artikelAnlage(neueUuid(), 'A1')
    const a2 = artikelAnlage(neueUuid(), 'A2')
    await outboxAdd('artikel', 'create', a1)
    await outboxAdd('artikel', 'create', a2)
    const outboxItems = await getDb().outbox.toArray()
    const outboxIds = outboxItems.map((o) => o.id).sort()
    const payloadIds = [a1.id, a2.id].sort()
    // Sanity-Check: Outbox-IDs und Payload-IDs sind tatsächlich verschieden.
    for (const oid of outboxIds) expect(payloadIds).not.toContain(oid)

    // Mock: Server akzeptiert a1, lehnt a2 als Konflikt ab.
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/sync/push') && method === 'POST') {
        return new Response(
          JSON.stringify({
            accepted: [a1.id],
            conflicts: [{ id: a2.id, reason: 'stale' }],
            errors: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/api/sync/snapshot')) {
        return new Response(
          JSON.stringify({
            serverTime: new Date().toISOString(),
            since: '1970-01-01T00:00:00.000Z',
            artikel: [],
            standorte: [],
            projekte: [],
            buchungen: [],
            einstellungen: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/sync/status')) {
        return new Response(
          JSON.stringify({
            serverTime: new Date().toISOString(),
            counts: { artikel: 0, standorte: 0, projekte: 0, buchungen: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    // Act
    const { runSync } = await import('../worker')
    await runSync({ token: null, apiBase: 'http://test.local' })

    // Assert
    const remaining = await getDb().outbox.toArray()
    const pending = remaining.filter((o) => o.syncedAt === null)
    const synced = remaining.filter((o) => o.syncedAt !== null)

    // a1 wurde akzeptiert → exakt ein Outbox-Item synced.
    expect(synced.length).toBe(1)
    // a2 wurde als Konflikt markiert → bleibt pending, hat aber lastError.
    expect(pending.length).toBe(1)
    expect(pending[0]?.lastError).toContain('CONFLICT')
    expect(pending[0]?.lastError).toContain('stale')

    // Cross-Check: Die synced-Outbox-ID ist die von a1 (nicht eine Payload-UUID).
    const syncedOutbox = synced[0]?.id
    expect(syncedOutbox).toBe(
      outboxItems.find((o) => {
        const p = JSON.parse(o.payload) as { id: string }
        return p.id === a1.id
      })?.id,
    )
  })

  it('Netzwerk-Fehler im Push markiert alle Items als failed (lastError gesetzt)', async () => {
    await outboxAdd('artikel', 'create', artikelAnlage(neueUuid(), 'A1'))

    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runSync } = await import('../worker')
    await runSync({ token: null, apiBase: 'http://test.local' })

    const items = await getDb().outbox.toArray()
    expect(items.length).toBe(1)
    expect(items[0]?.syncedAt).toBeNull()
    expect(items[0]?.attempts).toBe(1)
    expect(items[0]?.lastError).toContain('Failed to fetch')
  })
})

describe('Sync — Backoff & Retry-After', () => {
  it('computeBackoffMs: 0 beim ersten Versuch, dann 1s, 2s, 4s, … mit Cap', async () => {
    const { computeBackoffMs } = await import('../worker')
    expect(computeBackoffMs(0)).toBe(0)
    expect(computeBackoffMs(1)).toBe(1_000)
    expect(computeBackoffMs(2)).toBe(2_000)
    expect(computeBackoffMs(3)).toBe(4_000)
    expect(computeBackoffMs(4)).toBe(8_000)
    expect(computeBackoffMs(10)).toBe(60_000) // cap
  })

  it('parseRetryAfter: Sekunden und HTTP-Datum werden erkannt, Cap greift', async () => {
    const { parseRetryAfter } = await import('../worker')
    const now = Date.parse('2026-01-01T12:00:00.000Z')
    expect(parseRetryAfter('60', 5 * 60_000, now)).toBe(60_000)
    expect(parseRetryAfter('0', 5 * 60_000, now)).toBe(0)
    // 600s > 5min cap → 300_000
    expect(parseRetryAfter('600', 5 * 60_000, now)).toBe(300_000)
    // HTTP-Datum 30s in der Zukunft
    const future = new Date(now + 30_000).toUTCString()
    const got = parseRetryAfter(future, 5 * 60_000, now)
    expect(got).not.toBeNull()
    expect(got!).toBeGreaterThanOrEqual(29_000)
    expect(got!).toBeLessThanOrEqual(30_000)
    // Müll
    expect(parseRetryAfter('banana', 5 * 60_000, now)).toBeNull()
    expect(parseRetryAfter(null, 5 * 60_000, now)).toBeNull()
    expect(parseRetryAfter('', 5 * 60_000, now)).toBeNull()
  })

  it('5xx setzt status "origin-unavailable" und plant nextRetryAt anhand Retry-After', async () => {
    // Outbox-Item anlegen, damit der Push-Handler überhaupt zum Server geht.
    await outboxAdd('artikel', 'create', artikelAnlage(neueUuid(), 'A1'))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/sync/push')) {
        return new Response('Bad Gateway', {
          status: 502,
          headers: { 'Retry-After': '60' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runSync, getSyncStatus } = await import('../worker')
    await runSync({ token: null, apiBase: 'http://test.local' })

    const st = getSyncStatus()

    expect(st.status).toBe('origin-unavailable')
    expect(st.lastError).toContain('502')
    expect(st.nextRetryAt).not.toBeNull()
    const nextMs = Date.parse(st.nextRetryAt!) - Date.now()
    // Cloudflare-Antwort sagt 60s — Worker cappt nicht (60_000 < 300_000).
    expect(nextMs).toBeGreaterThan(50_000)
    expect(nextMs).toBeLessThan(70_000)
  })

  it('Netzwerk-Fehler erhöht Backoff über mehrere Versuche (exponentiell)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runSync, getSyncStatus } = await import('../worker')

    await runSync({ token: null, apiBase: 'http://test.local' })
    let nextMs = Date.parse(getSyncStatus().nextRetryAt!) - Date.now()
    expect(nextMs).toBeGreaterThan(500)
    expect(nextMs).toBeLessThan(1_500)

    await runSync({ token: null, apiBase: 'http://test.local' })
    nextMs = Date.parse(getSyncStatus().nextRetryAt!) - Date.now()
    expect(nextMs).toBeGreaterThan(1_500)
    expect(nextMs).toBeLessThan(2_500)
  })
})

describe('Sync — Diagnose (lastFailure)', () => {
  it('5xx füllt lastFailure mit status, code, source und retryAfterMs', async () => {
    // Outbox-Item anlegen, damit der Push-Handler überhaupt zum Server geht.
    await outboxAdd('artikel', 'create', artikelAnlage(neueUuid(), 'A1'))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/sync/push')) {
        return new Response('Bad Gateway', {
          status: 502,
          headers: { 'Retry-After': '30' },
        })
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runSync, getSyncStatus } = await import('../worker')
    await runSync({ token: null, apiBase: 'http://test.local' })

    const st = getSyncStatus()
    expect(st.lastFailure).not.toBeNull()
    expect(st.lastFailure?.source).toBe('push')
    expect(st.lastFailure?.status).toBe(502)
    expect(st.lastFailure?.code).toBe('origin-unavailable')
    expect(st.lastFailure?.retryAfterMs).toBe(30_000)
    expect(st.lastFailure?.message).toContain('502')
  })

  it('Netzwerk-Fehler markiert lastFailure mit source=network', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runSync, getSyncStatus } = await import('../worker')
    await runSync({ token: null, apiBase: 'http://test.local' })

    const st = getSyncStatus()
    expect(st.lastFailure).not.toBeNull()
    expect(st.lastFailure?.source).toBe('network')
    expect(st.lastFailure?.status).toBeNull()
    expect(st.lastFailure?.code).toBe('NETWORK')
  })

  it('Server-Rejects füllen lastFailure mit sampleErrors + rejectedItems', async () => {
    const a1 = artikelAnlage(neueUuid(), 'A1')
    const a2 = artikelAnlage(neueUuid(), 'A2')
    await outboxAdd('artikel', 'create', a1)
    await outboxAdd('artikel', 'create', a2)

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/sync/push') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            accepted: [],
            conflicts: [],
            errors: [
              { id: a1.id, code: 'NEGATIVE_BESTAND', message: 'aktuell 0, angefordert 5' },
              { id: a2.id, code: 'UNBEKANNTE_REFERENZ', message: 'artikel unbekannt' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/api/sync/snapshot')) {
        return new Response(
          JSON.stringify({
            serverTime: new Date().toISOString(),
            since: '1970-01-01T00:00:00.000Z',
            artikel: [],
            standorte: [],
            projekte: [],
            buchungen: [],
            einstellungen: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/sync/status')) {
        return new Response(
          JSON.stringify({
            serverTime: new Date().toISOString(),
            counts: { artikel: 0, standorte: 0, projekte: 0, buchungen: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runSync, getSyncStatus } = await import('../worker')
    await runSync({ token: null, apiBase: 'http://test.local' })

    const st = getSyncStatus()
    expect(st.lastFailure).not.toBeNull()
    expect(st.lastFailure?.source).toBe('push')
    expect(st.lastFailure?.code).toBe('PARTIAL_REJECTED')
    expect(st.lastFailure?.rejectedItems).toBe(2)
    expect(st.lastFailure?.sampleErrors.length).toBe(2)
    expect(st.lastFailure?.sampleErrors[0]?.code).toBe('NEGATIVE_BESTAND')
    expect(st.lastFailure?.stuckItems.length).toBe(2)
  })

  it('Erfolgreicher Sync setzt lastFailure zurück auf null', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/sync/snapshot')) {
        return new Response(
          JSON.stringify({
            serverTime: new Date().toISOString(),
            since: '1970-01-01T00:00:00.000Z',
            artikel: [],
            standorte: [],
            projekte: [],
            buchungen: [],
            einstellungen: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/sync/status')) {
        return new Response(
          JSON.stringify({
            serverTime: new Date().toISOString(),
            counts: { artikel: 0, standorte: 0, projekte: 0, buchungen: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runSync, getSyncStatus } = await import('../worker')
    await runSync({ token: null, apiBase: 'http://test.local' })

    expect(getSyncStatus().lastFailure).toBeNull()
    expect(getSyncStatus().lastError).toBeNull()
  })
})

describe('Sync — 401 / Auth-Reset', () => {
  it('401 resettet Outbox-Items (attempts=0, lastError=null) und ruft onAuthRevoked genau einmal', async () => {
    const a1 = artikelAnlage(neueUuid(), 'A1')
    await outboxAdd('artikel', 'create', a1)
    // Vorschaden: ein Item mit hohem attempts-Wert simulieren
    const items = await getDb().outbox.toArray()
    await getDb().outbox.update(items[0]!.id, {
      attempts: 179,
      lastError: 'Push HTTP 401',
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/sync/push')) {
        return new Response(
          JSON.stringify({ code: 'UNAUTHORIZED', message: 'Token fehlt oder ungültig' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onAuthRevoked = vi.fn()
    const { runSync, startSyncWorker, stopSyncWorker } = await import('../worker')
    startSyncWorker({
      apiBase: 'http://test.local',
      getToken: () => 'tot',
      onAuthRevoked,
    })

    await runSync({ token: 'tot', apiBase: 'http://test.local' })

    // Outbox wurde zurückgesetzt
    const after = await getDb().outbox.toArray()
    expect(after[0]?.attempts).toBe(0)
    expect(after[0]?.lastError).toBeNull()
    expect(after[0]?.syncedAt).toBeNull()

    // Callback wurde aufgerufen
    expect(onAuthRevoked).toHaveBeenCalledTimes(1)

    // Ein zweiter Push (z. B. vom Worker-Tick) darf den Callback NICHT
    // erneut feuern — Latch hält.
    await runSync({ token: 'tot', apiBase: 'http://test.local' })
    expect(onAuthRevoked).toHaveBeenCalledTimes(1)

    stopSyncWorker()
  })

  it('Erfolgreicher Push nach Auth-Reset löst das Latch (Callback kann erneut feuern)', async () => {
    const a1 = artikelAnlage(neueUuid(), 'A1')
    await outboxAdd('artikel', 'create', a1)

    let pushCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/sync/push') && init?.method === 'POST') {
        pushCalls++
        if (pushCalls === 1) {
          console.log(`[mock] push call #${pushCalls} → 401`)
          return new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'Token ungültig' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        if (pushCalls === 2) {
          console.log(`[mock] push call #${pushCalls} → 200, accepted=[${a1.id}]`)
          return new Response(JSON.stringify({ accepted: [a1.id], conflicts: [], errors: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        console.log(`[mock] push call #${pushCalls} → 401 again`)
        return new Response(
          JSON.stringify({ code: 'UNAUTHORIZED', message: 'Token wieder ungültig' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/api/sync/snapshot')) {
        return new Response(
          JSON.stringify({
            serverTime: new Date().toISOString(),
            since: '1970-01-01T00:00:00.000Z',
            artikel: [],
            standorte: [],
            projekte: [],
            buchungen: [],
            einstellungen: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/sync/status')) {
        return new Response(
          JSON.stringify({
            serverTime: new Date().toISOString(),
            counts: { artikel: 0, standorte: 0, projekte: 0, buchungen: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onAuthRevoked = vi.fn()
    const { runSync, startSyncWorker, stopSyncWorker } = await import('../worker')
    startSyncWorker({
      apiBase: 'http://test.local',
      getToken: () => 'tot',
      onAuthRevoked,
    })

    // 1) 401
    await runSync({ token: 'tot', apiBase: 'http://test.local' })
    expect(onAuthRevoked).toHaveBeenCalledTimes(1)

    // 2) Erfolg (Token wurde vom User erneuert). Latch wird im success-Pfad
    //    geloest. Outbox a1 ist jetzt synced.
    await runSync({ token: 'frisch', apiBase: 'http://test.local' })
    expect(onAuthRevoked).toHaveBeenCalledTimes(1)

    // 3) Neues Outbox-Item hinzufuegen, damit der naechste runSync ueberhaupt
    //    einen Push absetzt.
    const a2 = artikelAnlage(neueUuid(), 'A2')
    await outboxAdd('artikel', 'create', a2)
    // Server-Fetch: jetzt 401 (User hat sich abgemeldet) → 3. Push → 401
    // → onAuthRevoked MUSS wieder feuern.
    await runSync({ token: 'tot', apiBase: 'http://test.local' })
    expect(onAuthRevoked).toHaveBeenCalledTimes(2)

    stopSyncWorker()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
