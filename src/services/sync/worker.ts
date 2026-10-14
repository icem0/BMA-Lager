// Sync-Worker: pusht die lokale Outbox zum Server und holt den aktuellen
// Snapshot.
//
// Strategie (PLAN §9b):
//   1. Push (POST /api/sync/push): alle Outbox-Einträge mit syncedAt=null
//   2. Pull (GET /api/sync/snapshot?since=<lastPull>): aktualisiert lokale DB
//   3. Conflict-Resolution: Server hat Vorrang (Last-Writer-Wins auf
//      geaendertAm), Client sieht Server-Version in der nächsten Pull
//
// Backoff bei Fehler: 1s, 2s, 4s, 8s, 16s, 32s, 60s (cap).
// Wir laufen in einem setInterval + bei `online`-Event + bei `visibilitychange`.

import { getDb } from '../../db/database'
import type { Artikel, Buchung, OutboxEintrag, OutboxOp, Projekt, Standort } from '../../db/types'
import { jetztIso, neueUuid } from '../../domain/ids'
import { setApiBaseUrl } from '../../auth/api'

// ---------- Konfiguration ----------

const BATCH_SIZE = 200

// ---------- Typen ----------

export interface SyncSnapshot {
  serverTime: string
  since: string
  artikel: Artikel[]
  standorte: Standort[]
  projekte: Projekt[]
  buchungen: Buchung[]
}

export interface PushResult {
  accepted: string[]
  conflicts: Array<{ id: string; reason: string }>
  errors: Array<{
    id: string
    code: string
    message: string
    currentBestand?: number
  }>
}

export interface TableCounts {
  artikel: number
  standorte: number
  projekte: number
  buchungen: number
}

export interface ServerStatus {
  serverTime: string
  counts: TableCounts
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'offline' | 'error'
  pending: number
  lastSyncAt: string | null
  lastError: string | null
  /** Counts pro Tabelle, zuletzt vom Server gemeldet. */
  serverCounts: TableCounts | null
  /** Counts pro Tabelle in der lokalen IndexedDB. */
  localCounts: TableCounts | null
  /** Server-Zeitpunkt der letzten Counts-Abfrage (ISO). */
  serverTime: string | null
}

const LISTENERS = new Set<(s: SyncStatus) => void>()
let _status: SyncStatus = {
  status: 'idle',
  pending: 0,
  lastSyncAt: null,
  lastError: null,
  serverCounts: null,
  localCounts: null,
  serverTime: null,
}
let _intervalHandle: ReturnType<typeof setInterval> | null = null
let _running = false

export function getSyncStatus(): SyncStatus {
  return _status
}

export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  LISTENERS.add(fn)
  return () => LISTENERS.delete(fn)
}

function updateStatus(patch: Partial<SyncStatus>): void {
  _status = { ..._status, ...patch }
  for (const l of LISTENERS) l(_status)
}

// ---------- API-Calls ----------

async function fetchSnapshot(
  apiBase: string,
  token: string | null,
  since: string,
): Promise<SyncSnapshot> {
  const url = `${apiBase}/api/sync/snapshot${since ? `?since=${encodeURIComponent(since)}` : ''}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(`Snapshot HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }
  return (await res.json()) as SyncSnapshot
}

async function pushOps(apiBase: string, token: string | null, ops: unknown[]): Promise<PushResult> {
  const res = await fetch(`${apiBase}/api/sync/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify({ ops }),
  })
  if (!res.ok) {
    throw new Error(`Push HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }
  return (await res.json()) as PushResult
}

async function fetchServerStatus(apiBase: string, token: string | null): Promise<ServerStatus> {
  const res = await fetch(`${apiBase}/api/sync/status`, {
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(`Status HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }
  return (await res.json()) as ServerStatus
}

async function getLocalCounts(): Promise<TableCounts> {
  const db = getDb()
  const [artikel, standorte, projekte, buchungen] = await Promise.all([
    db.artikel.count(),
    db.standorte.count(),
    db.projekte.count(),
    db.buchungen.count(),
  ])
  return { artikel, standorte, projekte, buchungen }
}

// ---------- Outbox-Helfer ----------

async function pendingCount(): Promise<number> {
  const all = await getDb().outbox.toArray()
  return all.filter((o) => o.syncedAt === null).length
}

async function nextBatch(): Promise<OutboxEintrag[]> {
  // Dexie unterstützt kein `where('syncedAt').equals(null)` direkt —
  // wir holen die ersten BATCH_SIZE und filtern in Memory.
  const all = await getDb().outbox.orderBy('createdAt').limit(BATCH_SIZE).toArray()
  return all.filter((o) => o.syncedAt === null)
}

async function markSynced(id: string): Promise<void> {
  await getDb().outbox.update(id, { syncedAt: jetztIso() })
}

async function markFailed(id: string, error: string): Promise<void> {
  const e = await getDb().outbox.get(id)
  if (!e) return
  await getDb().outbox.update(id, {
    attempts: e.attempts + 1,
    lastError: error,
  })
}

// ---------- Snapshot-Merge ----------

async function applySnapshot(snap: SyncSnapshot): Promise<void> {
  const db = getDb()
  await db.transaction('rw', [db.artikel, db.standorte, db.projekte, db.buchungen], async () => {
    // Artikel
    for (const a of snap.artikel) {
      const existing = await db.artikel.get(a.id)
      if (!existing) {
        await db.artikel.add(a)
      } else if ((a.geaendertAm ?? '') > (existing.geaendertAm ?? '')) {
        await db.artikel.put(a)
      }
    }
    // Standorte
    for (const s of snap.standorte) {
      const existing = await db.standorte.get(s.id)
      if (!existing) {
        await db.standorte.add(s)
      } else if ((s.geaendertAm ?? '') > (existing.geaendertAm ?? '')) {
        await db.standorte.put(s)
      }
    }
    // Projekte
    for (const p of snap.projekte) {
      const existing = await db.projekte.get(p.id)
      if (!existing) {
        await db.projekte.add(p)
      } else if ((p.geaendertAm ?? '') > (existing.geaendertAm ?? '')) {
        await db.projekte.put(p)
      }
    }
    // Buchungen — append-only, nur insert wenn unbekannt
    for (const b of snap.buchungen) {
      const existing = await db.buchungen.get(b.id)
      if (!existing) await db.buchungen.add(b)
    }
  })

  // serverTime als lastPull speichern (für nächste Inkremental-Sync)
  await getDb().einstellungen.put({ key: 'sync.lastPullAt', value: snap.serverTime })
  await getDb().einstellungen.put({ key: 'sync.lastPushAt', value: snap.serverTime })
}

// ---------- Sync-Hauptaufruf ----------

export async function runSync(opts: { token: string | null; apiBase: string }): Promise<void> {
  if (_running) return
  _running = true

  const { token, apiBase } = opts
  const lastPull = (await getDb().einstellungen.get('sync.lastPullAt'))?.value ?? null

  try {
    updateStatus({ status: 'syncing' })

    // 1) Push
    const batch = await nextBatch()
    if (batch.length > 0) {
      // Wir behalten für jedes Item den Outbox-Eintrag, damit wir hinterher
      // die richtige outbox.id markieren können. Der Server antwortet mit
      // `op.payload.id` (Domain-UUID) — nicht mit der Outbox-UUID.
      const items: Array<{ outboxId: string; payloadId: string }> = []
      const ops: Array<{ op: OutboxOp; entity: OutboxEintrag['entity']; payload: unknown }> = []
      for (const o of batch) {
        let payload: unknown
        try {
          payload = JSON.parse(o.payload)
        } catch (e) {
          // Korrupte Outbox-Zeile — markieren und überspringen.
          await markFailed(o.id, `CORRUPT_PAYLOAD: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
        const payloadId =
          payload && typeof payload === 'object' && 'id' in payload
            ? (payload as { id: unknown }).id
            : undefined
        if (typeof payloadId !== 'string' || payloadId.length === 0) {
          await markFailed(o.id, 'MISSING_PAYLOAD_ID')
          continue
        }
        items.push({ outboxId: o.id, payloadId })
        ops.push({ op: o.op, entity: o.entity, payload })
      }
      if (ops.length > 0) {
        try {
          const result = await pushOps(apiBase, token, ops)
          const acceptedIds = new Set(result.accepted)
          const conflictsById = new Map(result.conflicts.map((c) => [c.id, c.reason]))
          const errorsById = new Map(result.errors.map((e) => [e.id, `${e.code}: ${e.message}`]))
          for (const it of items) {
            if (acceptedIds.has(it.payloadId)) {
              await markSynced(it.outboxId)
            } else if (conflictsById.has(it.payloadId)) {
              await markFailed(it.outboxId, `CONFLICT: ${conflictsById.get(it.payloadId)}`)
            } else if (errorsById.has(it.payloadId)) {
              await markFailed(it.outboxId, errorsById.get(it.payloadId) ?? 'ERROR')
            }
            // Wenn der Server das Item weder in accepted noch in conflicts/errors
            // erwähnt, lassen wir es unangetastet — kein Hinweis auf Erfolg oder
            // Misserfolg, also besser nicht voreilig markieren.
          }
        } catch (e) {
          // Gesamter Push fehlgeschlagen (z. B. Netzwerk). Alle markieren.
          const msg = e instanceof Error ? e.message : String(e)
          for (const it of items) await markFailed(it.outboxId, msg)
          throw e
        }
      }
    }

    // 2) Pull
    const snap = await fetchSnapshot(apiBase, token, lastPull ?? '1970-01-01T00:00:00.000Z')
    await applySnapshot(snap)

    // 3) Server-Status für Divergenz-Anzeige holen
    let serverCounts: TableCounts | null = _status.serverCounts
    let serverTime: string | null = _status.serverTime
    try {
      const st = await fetchServerStatus(apiBase, token)
      serverCounts = st.counts
      serverTime = st.serverTime
    } catch {
      // Counts sind nur Anzeige – Fehler hier sind nicht kritisch.
    }

    const localCounts = await getLocalCounts()

    updateStatus({
      status: 'idle',
      lastSyncAt: jetztIso(),
      lastError: null,
      pending: await pendingCount(),
      serverCounts,
      serverTime,
      localCounts,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    let localCounts: TableCounts | null = _status.localCounts
    try {
      localCounts = await getLocalCounts()
    } catch {
      // Counts sind nur Anzeige – Fehler hier sind nicht kritisch.
    }
    if (/Failed to fetch|NetworkError|fetch/i.test(msg)) {
      updateStatus({
        status: 'offline',
        lastError: msg,
        pending: await pendingCount(),
        localCounts,
      })
    } else {
      updateStatus({
        status: 'error',
        lastError: msg,
        pending: await pendingCount(),
        localCounts,
      })
    }
  } finally {
    _running = false
  }
}

// ---------- Manueller Sync + Status-Refresh ----------

/**
 * Triggert einen Sync-Lauf sofort (Push + Pull + Server-Status).
 * Kein Effekt, wenn gerade schon ein Sync läuft.
 */
export async function triggerSyncNow(opts: {
  token: string | null
  apiBase: string
}): Promise<void> {
  await runSync(opts)
}

/**
 * Holt frische Server-Counts, ohne einen vollen Sync zu fahren.
 * Aktualisiert auch die lokalen Counts.
 */
export async function refreshStatus(opts: {
  token: string | null
  apiBase: string
}): Promise<void> {
  let localCounts: TableCounts | null = _status.localCounts
  let serverCounts: TableCounts | null = _status.serverCounts
  let serverTime: string | null = _status.serverTime
  let lastError: string | null = null

  try {
    localCounts = await getLocalCounts()
  } catch {
    // s. o.
  }

  try {
    const st = await fetchServerStatus(opts.apiBase, opts.token)
    serverCounts = st.counts
    serverTime = st.serverTime
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
  }

  updateStatus({ localCounts, serverCounts, serverTime, lastError })
}

// ---------- Worker-Lifecycle ----------

export interface WorkerOptions {
  apiBase: string
  /** Funktion, die das aktuelle JWT liefert (z. B. aus Pinia-Store). */
  getToken: () => string | null
  /** Sync-Intervall in Sekunden. */
  intervalSek?: number
}

export function startSyncWorker(opts: WorkerOptions): void {
  if (_intervalHandle) return
  setApiBaseUrl(opts.apiBase)
  const intervalMs = (opts.intervalSek ?? 30) * 1000

  const tick = () => {
    void runSync({ token: opts.getToken(), apiBase: opts.apiBase })
  }
  _intervalHandle = setInterval(tick, intervalMs)

  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick()
  })

  // Initial-Push nach kurzer Verzögerung (App-Boot)
  setTimeout(tick, 2_000)
}

export function stopSyncWorker(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle)
    _intervalHandle = null
  }
}

// ---------- Outbox-Append ----------

export async function queueOp(
  entity: OutboxEintrag['entity'],
  op: OutboxOp,
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

// Hilfsimporte (noUnusedLocals)
