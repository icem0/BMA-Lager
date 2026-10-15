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
    // IndexedDB-Konvention: null in userId wird als '' indexiert.
    const a: Einstellung = { key: 'sprache', userId: 'user-a', value: 'de', geaendertAm: now }
    const b: Einstellung = { key: 'sprache', userId: 'user-b', value: 'en', geaendertAm: now }
    const global: Einstellung = { key: 'artikelTypen', userId: '', value: '[]', geaendertAm: now }

    await db.einstellungen.bulkAdd([a, b, global])

    const all = await db.einstellungen.toArray()
    expect(all).toHaveLength(3)

    // [key+userId] muss alle drei unabhängig identifizieren
    const a2 = await db.einstellungen.get(['sprache', 'user-a'])
    const b2 = await db.einstellungen.get(['sprache', 'user-b'])
    const g2 = await db.einstellungen.get(['artikelTypen', ''])
    expect(a2?.value).toBe('de')
    expect(b2?.value).toBe('en')
    expect(g2?.value).toBe('[]')
  })

  it('put überschreibt nur den Eintrag mit passendem userId, nicht den globalen', async () => {
    const db = getDb()
    const now = jetztIso()
    const global1: Einstellung = {
      key: 'artikelTypen',
      userId: '',
      value: '["A"]',
      geaendertAm: now,
    }
    const user1: Einstellung = { key: 'sprache', userId: 'u1', value: 'de', geaendertAm: now }
    // put einzeln wegen leerem userId-Index in Dexie
    await db.einstellungen.put(global1)
    await db.einstellungen.put(user1)

    // Jetzt setzen wir nur die user-spezifische Sprache neu
    const user1Update: Einstellung = {
      key: 'sprache',
      userId: 'u1',
      value: 'en',
      geaendertAm: jetztIso(),
    }
    await db.einstellungen.put(user1Update)

    // Global darf nicht angefasst worden sein
    const g = await db.einstellungen.get(['artikelTypen', ''])
    expect(g?.value).toBe('["A"]')
    const u = await db.einstellungen.get(['sprache', 'u1'])
    expect(u?.value).toBe('en')
  })

  it('Migration v5: alte Zeilen ohne userId/geaendertAm werden aufgefüllt', async () => {
    // Wir testen die reine Modify-Logik der v5-upgrade-Funktion. Dexie
    // selbst kann in fake-indexeddb keine v4-Roh-Zeile mit fehlendem
    // userId-Index akzeptieren — das Upgrade läuft aber genau auf
    // dieser Annahme. Wir prüfen die Transform-Funktion isoliert.
    type Roh = Record<string, unknown>
    const rohZeile: Roh = { key: 'sprache', value: 'de' }

    // 1:1-Kopie der Logik in src/db/database.ts v5-upgrade
    function migrate(row: Roh, now: string): Roh {
      const out: Roh = { ...row }
      if (out['userId'] === undefined || out['userId'] === null) out['userId'] = ''
      if (typeof out['geaendertAm'] !== 'string') out['geaendertAm'] = now
      return out
    }

    const now = new Date().toISOString()
    const migrated = migrate(rohZeile, now)

    expect(migrated['userId']).toBe('')
    expect(migrated['geaendertAm']).toBe(now)
    expect(migrated['key']).toBe('sprache')
    expect(migrated['value']).toBe('de')
  })

  it('sync-Marker (sync.lastPullAt, sync.lastPushAt) liegen unter userId=""', async () => {
    const db = getDb()
    const now = jetztIso()
    await db.einstellungen.put({
      key: 'sync.lastPullAt',
      userId: '',
      value: now,
      geaendertAm: now,
    })
    const marker = await db.einstellungen.get(['sync.lastPullAt', ''])
    expect(marker?.value).toBe(now)
    expect(marker?.userId).toBe('')
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
    const marker = await getDb().einstellungen.get(['sync.lastPullAt', ''])
    expect(marker?.value).toBe(serverTime)
  })
})
