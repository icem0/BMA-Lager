// Sync-Worker: pusht die lokale Outbox zum Server und holt den aktuellen
// Snapshot.
//
// Strategie (PLAN §9b):
//   1. Push (POST /api/sync/push): alle Outbox-Einträge mit syncedAt=null
//   2. Pull (GET /api/sync/snapshot?since=<lastPull>): aktualisiert lokale DB
//   3. Conflict-Resolution: Server hat Vorrang (Last-Writer-Wins auf
//      geaendertAm), Client sieht Server-Version in der nächsten Pull
//
// Backoff bei Server-Fehlern (5xx, Network, Origin-unavailable):
//   - Cloudflare / Fastify können `Retry-After` setzen — wir respektieren
//     ihn (cap 5 Min) und pausieren den Worker entsprechend.
//   - Sonst: 1s, 2s, 4s, 8s, 16s, 32s, 60s (Cap), gesteuert über
//     `computeBackoffMs(attempts)`.
// Wir laufen in einem setInterval + bei `online`-Event + bei `visibilitychange`.

import { getDb } from '../../db/database'
import type { Artikel, Buchung, OutboxEintrag, OutboxOp, Projekt, Standort } from '../../db/types'
import { jetztIso, neueUuid } from '../../domain/ids'
import { setApiBaseUrl } from '../../auth/api'

// ---------- Konfiguration ----------

const BATCH_SIZE = 200
/** Maximales Backoff-Intervall, wenn der Server nichts Konkreteres sagt. */
const BACKOFF_CAP_MS = 60_000
/** Hard cap für ein vom Server vorgegebenes Retry-After (Cloudflare 502: 60s). */
const RETRY_AFTER_CAP_MS = 5 * 60_000

// ---------- Backoff (rein, ohne Side-Effects → testbar) ----------

/**
 * Exponentielles Backoff: 1s, 2s, 4s, … mit Cap.
 * `attempts` ist die Anzahl der bisherigen Fehlversuche in Folge (≥ 0).
 */
export function computeBackoffMs(attempts: number, capMs: number = BACKOFF_CAP_MS): number {
  if (attempts <= 0) return 0
  const exp = Math.min(attempts - 1, 16)
  const ms = 1_000 * 2 ** exp
  return Math.min(ms, capMs)
}

/**
 * Parst `Retry-After`-Header (Sekunden ODER HTTP-Datum) und cappt auf
 * `capMs`. Liefert `null`, wenn nichts Verwertbares drinsteht.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  capMs: number = RETRY_AFTER_CAP_MS,
  now: number = Date.now(),
): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (!trimmed) return null
  // Sekunden (relativ)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const sec = Number(trimmed)
    if (!Number.isFinite(sec) || sec < 0) return null
    return Math.min(sec * 1_000, capMs)
  }
  // HTTP-Datum
  const t = Date.parse(trimmed)
  if (!Number.isNaN(t)) {
    return Math.min(Math.max(0, t - now), capMs)
  }
  return null
}

// ---------- HTTP-Fehler ----------

/** Vom Server stammender Fehler mit optionalem Retry-After. */
export class SyncHttpError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null
  /** Kurzer Anzeige-Code für die UI (z. B. "origin-unavailable"). */
  readonly category: 'origin-unavailable' | 'auth' | 'validation' | 'http'

  constructor(
    status: number,
    message: string,
    opts: { retryAfterMs?: number | null; category?: SyncHttpError['category'] } = {},
  ) {
    super(message)
    this.name = 'SyncHttpError'
    this.status = status
    this.retryAfterMs = opts.retryAfterMs ?? null
    this.category = opts.category ?? (status >= 500 ? 'origin-unavailable' : 'http')
  }
}

function categorizeStatus(status: number): SyncHttpError['category'] {
  if (status === 401 || status === 403) return 'auth'
  if (status >= 400 && status < 500) return 'validation'
  if (status >= 500) return 'origin-unavailable'
  return 'http'
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text()
    // Cloudflare-5xx-Fehlermeldungen sind JSON, aber für die UI reicht
    // ein kurzer Header plus der Status.
    return text.length > 240 ? `${text.slice(0, 240)}…` : text
  } catch {
    return ''
  }
}

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

/** Wo der letzte Server-Fehler aufgetreten ist. */
export type SyncFailureSource = 'push' | 'snapshot' | 'status' | 'network' | null

/** Strukturierte Diagnose-Info für den letzten Fehler. */
export interface SyncLastFailure {
  /** Wann der Fehler aufgetreten ist (ISO). */
  at: string
  /** Welcher Sync-Schritt hat versagt. */
  source: SyncFailureSource
  /** HTTP-Status, falls zutreffend. */
  status: number | null
  /** Kurzer Code aus der Server-Antwort (z. B. "VALIDATION", "NEGATIVE_BESTAND"). */
  code: string | null
  /** Menschenlesbare Message. */
  message: string
  /** Vom Server gesetztes Retry-After (ms), falls vorhanden. */
  retryAfterMs: number | null
  /** Anzahl Outbox-Items, die im letzten Push abgelehnt wurden (errors+conflicts). */
  rejectedItems: number
  /** Erste paar Beispiele aus `result.errors` für Diagnose. */
  sampleErrors: Array<{ id: string; code: string; message: string }>
  /** Erste paar Outbox-Items mit lastError (sichtbar in der UI). */
  stuckItems: Array<{
    outboxId: string
    entity: string
    op: string
    payloadId: string
    attempts: number
    lastError: string | null
    createdAt: string
  }>
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'offline' | 'error' | 'origin-unavailable'
  pending: number
  lastSyncAt: string | null
  lastError: string | null
  /** Counts pro Tabelle, zuletzt vom Server gemeldet. */
  serverCounts: TableCounts | null
  /** Counts pro Tabelle in der lokalen IndexedDB. */
  localCounts: TableCounts | null
  /** Server-Zeitpunkt der letzten Counts-Abfrage (ISO). */
  serverTime: string | null
  /** Wann der nächste Sync-Versuch starten soll (ISO). `null` = sofort erlaubt. */
  nextRetryAt: string | null
  /** Strukturierte Diagnose-Info für den letzten Fehler (oder `null`). */
  lastFailure: SyncLastFailure | null
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
  nextRetryAt: null,
  lastFailure: null,
}
let _intervalHandle: ReturnType<typeof setInterval> | null = null
let _running = false
/** Anzahl der aufeinanderfolgenden Fehlversuche (für Backoff). */
let _consecutiveFailures = 0

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
    const body = await readErrorBody(res)
    const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'))
    throw new SyncHttpError(res.status, `Snapshot HTTP ${res.status}: ${body}`, {
      retryAfterMs,
      category: categorizeStatus(res.status),
    })
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
    const body = await readErrorBody(res)
    const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'))
    throw new SyncHttpError(res.status, `Push HTTP ${res.status}: ${body}`, {
      retryAfterMs,
      category: categorizeStatus(res.status),
    })
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
    const body = await readErrorBody(res)
    const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'))
    throw new SyncHttpError(res.status, `Status HTTP ${res.status}: ${body}`, {
      retryAfterMs,
      category: categorizeStatus(res.status),
    })
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

/**
 * Liest die ersten N Outbox-Items mit lastError, die noch nicht synced sind.
 * Dient als Diagnose für die UI: "Was genau hängt?".
 */
async function collectStuckItems(limit = 5): Promise<SyncLastFailure['stuckItems']> {
  const all = await getDb().outbox.orderBy('createdAt').toArray()
  const stuck = all.filter((o) => o.syncedAt === null && o.lastError)
  const out: SyncLastFailure['stuckItems'] = []
  for (const o of stuck.slice(0, limit)) {
    let payloadId = ''
    try {
      const parsed = JSON.parse(o.payload) as { id?: unknown }
      payloadId = typeof parsed.id === 'string' ? parsed.id : ''
    } catch {
      // korrupte payload — Diagnose zeigt leere ID
    }
    out.push({
      outboxId: o.id,
      entity: o.entity,
      op: o.op,
      payloadId,
      attempts: o.attempts,
      lastError: o.lastError,
      createdAt: o.createdAt,
    })
  }
  return out
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
          // Diagnose: sammle die ersten paar Server-Fehler, damit die UI
          // zeigen kann, WARUM der Server das Item abgelehnt hat.
          const sampleErrors: SyncLastFailure['sampleErrors'] = result.errors
            .slice(0, 3)
            .map((e) => ({ id: e.id, code: e.code, message: e.message }))
          const lastPushDiagnosis: Pick<SyncLastFailure, 'rejectedItems' | 'sampleErrors'> = {
            rejectedItems: result.conflicts.length + result.errors.length,
            sampleErrors,
          }
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
          // Wenn der Server einige Items abgelehnt hat, aber der Push insgesamt
          // 200 war, ist das ein "partieller Erfolg". Das ist KEIN fataler
          // Fehler — der Worker läuft normal weiter. Wir hängen die Diagnose
          // aber an den Status, damit die UI sie sehen kann.
          if (lastPushDiagnosis.rejectedItems > 0) {
            updateStatus({
              lastError: `Server hat ${lastPushDiagnosis.rejectedItems} von ${items.length} Items abgelehnt`,
              lastFailure: {
                at: jetztIso(),
                source: 'push',
                status: 200,
                code: 'PARTIAL_REJECTED',
                message: `Server hat ${lastPushDiagnosis.rejectedItems} von ${items.length} Items abgelehnt`,
                retryAfterMs: null,
                ...lastPushDiagnosis,
                stuckItems: await collectStuckItems(5),
              },
            })
          }
        } catch (e) {
          // Gesamter Push fehlgeschlagen (z. B. Netzwerk oder HTTP-Fehler).
          const http = e instanceof SyncHttpError ? e : null
          const msg = e instanceof Error ? e.message : String(e)
          for (const it of items) await markFailed(it.outboxId, msg)
          updateStatus({
            lastError: msg,
            lastFailure: {
              at: jetztIso(),
              source: http ? 'push' : 'network',
              status: http?.status ?? null,
              code: http?.category ?? 'NETWORK',
              message: msg,
              retryAfterMs: http?.retryAfterMs ?? null,
              rejectedItems: 0,
              sampleErrors: [],
              stuckItems: await collectStuckItems(5),
            },
          })
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
      // lastError/lastFailure nur zurücksetzen, wenn nicht partiell
      // abgelehnt wurde (das Push-Handler-Update setzt eine Diagnose,
      // die wir hier nicht überschreiben wollen).
      lastError: _status.lastFailure?.code === 'PARTIAL_REJECTED' ? _status.lastError : null,
      lastFailure: _status.lastFailure?.code === 'PARTIAL_REJECTED' ? _status.lastFailure : null,
      pending: await pendingCount(),
      serverCounts,
      serverTime,
      localCounts,
      nextRetryAt: null,
    })
    _consecutiveFailures = 0
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    let localCounts: TableCounts | null = _status.localCounts
    try {
      localCounts = await getLocalCounts()
    } catch {
      // Counts sind nur Anzeige – Fehler hier sind nicht kritisch.
    }

    const isNetwork = /Failed to fetch|NetworkError|fetch|load failed/i.test(msg)
    const http = e instanceof SyncHttpError ? e : null

    _consecutiveFailures++
    const backoffMs = computeBackoffMs(_consecutiveFailures)
    // Retry-After hat Vorrang, wenn der Server ihn gesetzt hat.
    const waitMs = http?.retryAfterMs ?? backoffMs
    const nextRetryAt = waitMs > 0 ? new Date(Date.now() + waitMs).toISOString() : null

    // Diagnose: nur setzen, wenn der innere Push-Handler es nicht schon getan
    // hat (partieller Erfolg mit Server-Rejects). Sonst überschreiben wir
    // dessen Source/Code mit der hier beobachteten Information.
    const existingFailure = _status.lastFailure
    const newFailure: SyncLastFailure = {
      at: jetztIso(),
      source: existingFailure?.source ?? (isNetwork ? 'network' : 'snapshot'),
      status: http?.status ?? null,
      code: http?.category ?? (isNetwork ? 'NETWORK' : 'UNKNOWN'),
      message: msg,
      retryAfterMs: http?.retryAfterMs ?? null,
      rejectedItems: existingFailure?.rejectedItems ?? 0,
      sampleErrors: existingFailure?.sampleErrors ?? [],
      stuckItems: await collectStuckItems(5),
    }

    if (isNetwork) {
      updateStatus({
        status: 'offline',
        lastError: msg,
        pending: await pendingCount(),
        localCounts,
        nextRetryAt,
        lastFailure: newFailure,
      })
    } else if (http?.category === 'origin-unavailable') {
      // 5xx: Server/Origin ist down — kein Punkt, alle 30s zu hämmern.
      updateStatus({
        status: 'origin-unavailable',
        lastError: msg,
        pending: await pendingCount(),
        localCounts,
        nextRetryAt,
        lastFailure: newFailure,
      })
    } else if (http?.category === 'auth') {
      // Token abgelaufen o. ä. — User muss sich neu einloggen.
      updateStatus({
        status: 'error',
        lastError: msg,
        pending: await pendingCount(),
        localCounts,
        nextRetryAt,
        lastFailure: newFailure,
      })
    } else {
      updateStatus({
        status: 'error',
        lastError: msg,
        pending: await pendingCount(),
        localCounts,
        nextRetryAt,
        lastFailure: newFailure,
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
 * Backoff wird ignoriert — der User hat explizit geklickt.
 */
export async function triggerSyncNow(opts: {
  token: string | null
  apiBase: string
}): Promise<void> {
  _consecutiveFailures = 0
  updateStatus({ nextRetryAt: null })
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
    if (_running) return
    // Respektiere Backoff: wenn der letzte Lauf ein `nextRetryAt` gesetzt
    // hat, das in der Zukunft liegt, überspringen wir den Tick.
    if (_status.nextRetryAt) {
      const next = Date.parse(_status.nextRetryAt)
      if (Number.isFinite(next) && next > Date.now()) return
    }
    void runSync({ token: opts.getToken(), apiBase: opts.apiBase })
  }
  _intervalHandle = setInterval(tick, intervalMs)

  // Online-Event: Retry sofort versuchen, wenn der Origin wieder da ist.
  window.addEventListener('online', () => {
    if (_status.status === 'offline' || _status.status === 'origin-unavailable') {
      // Backoff zurücksetzen, damit wir nicht erst auf den nächsten Tick warten.
      _consecutiveFailures = 0
      updateStatus({ nextRetryAt: null })
    }
    tick()
  })
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

// ---------- Test-Helfer ----------

/**
 * Setzt den internen Sync-State (Counter, Status, lastError) zurück.
 * Nur in Tests verwenden.
 */
export function _resetSyncForTests(): void {
  _status = {
    status: 'idle',
    pending: 0,
    lastSyncAt: null,
    lastError: null,
    serverCounts: null,
    localCounts: null,
    serverTime: null,
    nextRetryAt: null,
    lastFailure: null,
  }
  _consecutiveFailures = 0
  if (_intervalHandle) {
    clearInterval(_intervalHandle)
    _intervalHandle = null
  }
}

// Hilfsimporte (noUnusedLocals)
