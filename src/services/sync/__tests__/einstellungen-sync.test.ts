// Tests für Einstellungs-Sync: applySnapshot, LWW auf geaendertAm, und
// den Compound-Key [key+userId].

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { getDb, setDb, resetDbForTests } from '../../../db/database'
import type { Einstellung } from '../../../db/types'
import { jetztIso } from '../../../domain/ids'

describe('einstellungen cross-device sync', () => {
  beforeEach(() => {
    resetDbForTests()
    setDb(getDb())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('compound key [key+userId] erlaubt mehrere user-spezifische Einträge', async () => {
    const db = getDb()
    const now = jetztIso()
    const a: Einstellung = { key: 'sprache', userId: 'user-a', value: 'de', geaendertAm: now }
    const b: Einstellung = { key: 'sprache', userId: 'user-b', value: 'en', geaendertAm: now }
    const global: Einstellung = { key: 'artikelTypen', userId: null, value: '[]', geaendertAm: now }

    await db.einstellungen.bulkAdd([a, b, global])

    const all = await db.einstellungen.toArray()
    expect(all).toHaveLength(3)

    // [key+userId] muss alle drei unabhängig identifizieren
    const a2 = await db.einstellungen.get(['sprache', 'user-a'])
    const b2 = await db.einstellungen.get(['sprache', 'user-b'])
    const g2 = await db.einstellungen.get(['artikelTypen', null])
    expect(a2?.value).toBe('de')
    expect(b2?.value).toBe('en')
    expect(g2?.value).toBe('[]')
  })

  it('put überschreibt nur den Eintrag mit passendem userId, nicht den globalen', async () => {
    const db = getDb()
    const now = jetztIso()
    const global1: Einstellung = {
      key: 'artikelTypen',
      userId: null,
      value: '["A"]',
      geaendertAm: now,
    }
    const user1: Einstellung = { key: 'sprache', userId: 'u1', value: 'de', geaendertAm: now }
    await db.einstellungen.bulkAdd([global1, user1])

    // Jetzt setzen wir nur die user-spezifische Sprache neu
    const user1Update: Einstellung = {
      key: 'sprache',
      userId: 'u1',
      value: 'en',
      geaendertAm: jetztIso(),
    }
    await db.einstellungen.put(user1Update)

    // Global darf nicht angefasst worden sein
    const g = await db.einstellungen.get(['artikelTypen', null])
    expect(g?.value).toBe('["A"]')
    const u = await db.einstellungen.get(['sprache', 'u1'])
    expect(u?.value).toBe('en')
  })

  it('Migration v5: alte Zeilen ohne userId/geaendertAm werden aufgefüllt', async () => {
    // Simuliere alte v4-Daten direkt in IndexedDB
    // raw-insert via getDb in v4
    const { BmaLagerDb } = await import('../../../db/database')
    const oldDb = new BmaLagerDb('legacy')
    // v4-Shape: key, value
    await oldDb.einstellungen.add({ key: 'sprache', value: 'de' } as unknown as Einstellung)
    // close
    oldDb.close()
    // neu öffnen als v5 -> Dexie sollte migrieren
    const newDb = new BmaLagerDb('legacy')
    const rows = await newDb.einstellungen.toArray()
    const sprache = rows.find((r) => r.key === 'sprache')
    expect(sprache).toBeDefined()
    expect(sprache?.userId).toBeNull()
    expect(typeof sprache?.geaendertAm).toBe('string')
    newDb.close()
  })

  it('sync-Marker (sync.lastPullAt, sync.lastPushAt) bleiben unter userId=null', async () => {
    const db = getDb()
    const now = jetztIso()
    await db.einstellungen.put({
      key: 'sync.lastPullAt',
      userId: null,
      value: now,
      geaendertAm: now,
    })
    const marker = await db.einstellungen.get(['sync.lastPullAt', null])
    expect(marker?.value).toBe(now)
    expect(marker?.userId).toBeNull()
  })
})

describe('applySnapshot mit einstellungen', () => {
  beforeEach(() => {
    resetDbForTests()
    setDb(getDb())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('übernimmt neue Einstellungen und respektiert LWW auf geaendertAm', async () => {
    // Direkter Test von applySnapshot über den Mock-Fetch.
    const serverTime = jetztIso()
    const olderEinstellung: Einstellung = {
      key: 'sprache',
      userId: 'u1',
      value: 'de',
      geaendertAm: '2024-01-01T00:00:00.000Z',
    }
    const newerEinstellung: Einstellung = {
      key: 'sprache',
      userId: 'u1',
      value: 'en',
      geaendertAm: '2099-01-01T00:00:00.000Z',
    }

    // Vorab schon eine NEUERE lokale Zeile, die nicht überschrieben werden darf
    const localNewer: Einstellung = {
      key: 'sprache',
      userId: 'u1',
      value: 'fr',
      geaendertAm: '2099-06-01T00:00:00.000Z',
    }
    await getDb().einstellungen.put(localNewer)

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/sync/snapshot')) {
        return new Response(
          JSON.stringify({
            serverTime,
            since: '1970-01-01T00:00:00.000Z',
            artikel: [],
            standorte: [],
            projekte: [],
            buchungen: [],
            einstellungen: [olderEinstellung, newerEinstellung],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/api/sync/push')) {
        return new Response(JSON.stringify({ accepted: [], conflicts: [], errors: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/api/sync/status')) {
        return new Response(
          JSON.stringify({
            serverTime,
            counts: { artikel: 0, standorte: 0, projekte: 0, buchungen: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { runSync, _resetSyncForTests } = await import('../worker')
    _resetSyncForTests()
    await runSync({ token: null, apiBase: 'http://test.local' })

    // älterer Snapshot-Wert ('de') wird ignoriert, neuerer ('en') wird übernommen,
    // aber lokal-neuerer ('fr') bleibt
    const u = await getDb().einstellungen.get(['sprache', 'u1'])
    expect(u?.value).toBe('fr')

    // serverTime wurde als sync.lastPullAt gesetzt
    const marker = await getDb().einstellungen.get(['sync.lastPullAt', null])
    expect(marker?.value).toBe(serverTime)
  })
})
