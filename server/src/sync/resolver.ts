// Sync-Resolver: verarbeitet eine Liste von Outbox-Items.
//
// Strategie:
//   * Buchungen sind append-only — keine Konflikte. Wir prüfen Negativ-Bestand
//     (für 'entnahme') und unbekannte Referenzen.
//   * Artikel/Standort/Projekte: Last-Writer-Wins auf `geaendertAm`.
//     Wenn die Server-Version neuer ist als die eingehende, wird die Server-
//     Version beibehalten (Conflict-Response).
//
// Alles in einer DB-Transaktion pro Push-Batch.

import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema.js'
import { artikel, buchungen, einstellungen, projekte, standorte, auditLog } from '../db/schema.js'
import { berechneBestand } from '../domain/bestand.js'
import {
  NegativerBestandError,
  UnbekannteReferenzError,
  ValidationError,
} from '../domain/errors.js'
import { applyLastWriterWinsMock } from './__test-helpers__.js'

// ---------- Push-Payload-Type (siehe validierung.ts) ----------

export type PushOp = z.infer<typeof pushSchema>

// Schema nur für den Resolver (leichtgewichtige Variante)
const pushSchema = z.discriminatedUnion('entity', [
  z.object({
    op: z.enum(['create', 'update', 'delete']),
    entity: z.literal('artikel'),
    payload: z.any(),
  }),
  z.object({
    op: z.enum(['create', 'update', 'delete']),
    entity: z.literal('standort'),
    payload: z.any(),
  }),
  z.object({
    op: z.enum(['create', 'update', 'delete']),
    entity: z.literal('projekt'),
    payload: z.any(),
  }),
  z.object({
    op: z.literal('create'),
    entity: z.literal('buchung'),
    payload: z.any(),
  }),
  z.object({
    op: z.literal('upsert'),
    entity: z.literal('einstellung'),
    payload: z.any(),
  }),
])

export interface ResolverResult {
  accepted: string[] // op-IDs (payload.id)
  conflicts: Array<{
    id: string
    reason: string
  }>
  errors: Array<{
    id: string
    code: string
    message: string
    currentBestand?: number
  }>
}

export async function resolvePush(
  db: PostgresJsDatabase<typeof schema>,
  ops: ReadonlyArray<PushOp>,
  benutzerId: string,
  benutzerRolle: 'admin' | 'user' = 'user',
): Promise<ResolverResult> {
  const result: ResolverResult = { accepted: [], conflicts: [], errors: [] }

  for (const op of ops) {
    try {
      await db.transaction(async (tx) => {
        switch (op.entity) {
          case 'artikel':
            await resolveArtikel(tx, op)
            break
          case 'standort':
            await resolveStandort(tx, op)
            break
          case 'projekt':
            await resolveProjekt(tx, op)
            break
          case 'buchung':
            await resolveBuchung(tx, op, db)
            break
          case 'einstellung':
            await resolveEinstellung(tx, op, benutzerId, benutzerRolle)
            break
        }

        // Audit-Log
        const entitaetId =
          op.entity === 'einstellung'
            ? `${op.payload.key}#${op.payload.userId ?? 'global'}`
            : op.payload.id
        await tx.insert(auditLog).values({
          id: crypto.randomUUID(),
          aktion: op.op,
          entitaet: op.entity,
          entitaetId,
          benutzerId,
          daten: { op: op.op, entity: op.entity },
          zeit: new Date(),
        })

        result.accepted.push(entitaetId)
      })
    } catch (err) {
      if (err instanceof ConflictError) {
        result.conflicts.push({ id: op.payload.id, reason: err.message })
      } else if (err instanceof NegativerBestandError) {
        result.errors.push({
          id: op.payload.id,
          code: err.code,
          message: err.message,
          currentBestand: err.aktuellerBestand,
        })
      } else if (err instanceof UnbekannteReferenzError || err instanceof ValidationError) {
        result.errors.push({
          id: op.payload.id,
          code: err.code,
          message: err.message,
        })
      } else {
        result.errors.push({
          id: op.payload.id,
          code: 'INTERNAL',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return result
}

// ---------- Conflict ----------

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

// ---------- Stammdaten-Resolver ----------

type Tx = Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0]

async function resolveArtikel(
  tx: Tx,
  op: Extract<PushOp, { entity: 'artikel' }>,
): Promise<void> {
  if (op.op === 'create') {
    const existing = await tx.select().from(artikel).where(eq(artikel.id, op.payload.id)).limit(1)
    if (existing.length > 0) {
      // Idempotent: bereits vorhanden, einfach akzeptieren (Update-Fall)
      await applyLastWriterWins(tx, artikel, op.payload)
    } else {
      await tx.insert(artikel).values(op.payload)
    }
  } else if (op.op === 'update' || op.op === 'delete') {
    await applyLastWriterWins(tx, artikel, op.payload)
  }
}

async function resolveStandort(
  tx: Tx,
  op: Extract<PushOp, { entity: 'standort' }>,
): Promise<void> {
  if (op.op === 'create') {
    const existing = await tx.select().from(standorte).where(eq(standorte.id, op.payload.id)).limit(1)
    if (existing.length > 0) {
      await applyLastWriterWins(tx, standorte, op.payload)
    } else {
      await tx.insert(standorte).values(op.payload)
    }
  } else {
    await applyLastWriterWins(tx, standorte, op.payload)
  }
}

async function resolveProjekt(
  tx: Tx,
  op: Extract<PushOp, { entity: 'projekt' }>,
): Promise<void> {
  if (op.op === 'create') {
    const existing = await tx.select().from(projekte).where(eq(projekte.id, op.payload.id)).limit(1)
    if (existing.length > 0) {
      await applyLastWriterWins(tx, projekte, op.payload)
    } else {
      await tx.insert(projekte).values(op.payload)
    }
  } else {
    await applyLastWriterWins(tx, projekte, op.payload)
  }
}

// ---------- Last-Writer-Wins ----------

async function applyLastWriterWins(
  tx: Tx,
  table: typeof artikel | typeof standorte | typeof projekte,
  payload: Record<string, unknown>,
): Promise<void> {
  const id = payload['id'] as string
  const incomingGeaendertAm = new Date(payload['geaendertAm'] as string)

  const existing = await tx.select().from(table).where(eq(table.id, id)).limit(1)
  const current = existing[0]
  if (!current) {
    // Server hat es nicht (kann bei create passieren, wenn race-condition) — insert
    await tx.insert(table).values(payload as never)
    return
  }
  // Reine Logik in Test-Helper extrahiert
  applyLastWriterWinsMock({
    serverGeaendertAm: current.geaendertAm,
    incomingGeaendertAm,
    id,
  })
  await tx.update(table).set(payload as never).where(eq(table.id, id))
}

// ---------- Buchungs-Resolver ----------

async function resolveBuchung(
  tx: Tx,
  op: Extract<PushOp, { entity: 'buchung' }>,
  db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
  if (op.op !== 'create') {
    throw new ValidationError('buchung.op', 'nur "create" erlaubt (append-only)')
  }
  const b = op.payload as {
    id: string
    artikelId: string
    standortId: string
    standortZielId?: string | null
    typ: 'einlagerung' | 'entnahme' | 'umlagerung' | 'inventur' | 'kommission' | 'storno'
    menge: number
    paarId?: string | null
    projekt?: string | null
    erstelltAm: string
    clientEingabeAm?: string | null
    erstelltVon: string
    kommentar?: string | null
    mitteilungAn?: string | null
    stornoVon?: string | null
    storno: boolean
    storniertDurch?: string | null
  }

  // 1) Idempotenz: gleiche ID → 200 duplicate
  const existing = await tx.select().from(buchungen).where(eq(buchungen.id, b.id)).limit(1)
  if (existing.length > 0) return

  // 2) Referenz-Check
  const a = await tx.select({ id: artikel.id }).from(artikel).where(eq(artikel.id, b.artikelId)).limit(1)
  if (a.length === 0) throw new UnbekannteReferenzError('artikel', b.artikelId)
  const s = await tx
    .select({ id: standorte.id })
    .from(standorte)
    .where(eq(standorte.id, b.standortId))
    .limit(1)
  if (s.length === 0) throw new UnbekannteReferenzError('standort', b.standortId)
  if (b.standortZielId) {
    const s2 = await tx
      .select({ id: standorte.id })
      .from(standorte)
      .where(eq(standorte.id, b.standortZielId))
      .limit(1)
    if (s2.length === 0) throw new UnbekannteReferenzError('standort', b.standortZielId)
  }

  // 3) Negativ-Bestand-Check (nur für entnahme)
  if (b.typ === 'entnahme' && !b.storno) {
    const aktuell = await berechneBestand(db, b.artikelId, b.standortId)
    const neuerBestand = aktuell - Math.abs(b.menge)
    if (neuerBestand < 0) {
      throw new NegativerBestandError(b.artikelId, b.standortId, aktuell, Math.abs(b.menge))
    }
  }

  // 4) Insert
  await tx.insert(buchungen).values(b as never)
}

// ---------- Einstellungs-Resolver ----------
// Whitelist der erlaubten Keys. artikelTypen ist global und nur von
// Admins pflegbar. sprache und standardStandortId sind pro User.
const ADMIN_ONLY_KEYS = new Set<string>(['artikelTypen'])

async function resolveEinstellung(
  tx: Tx,
  op: Extract<PushOp, { entity: 'einstellung' }>,
  benutzerId: string,
  benutzerRolle: 'admin' | 'user',
): Promise<void> {
  const p = op.payload as {
    key: string
    userId: string | null
    value: string
    geaendertAm: string
  }

  // 1) Rollen-Check: artikelTypen (global) nur durch Admins
  if (p.userId === null && ADMIN_ONLY_KEYS.has(p.key) && benutzerRolle !== 'admin') {
    throw new ValidationError(
      'einstellung.userId',
      `Key "${p.key}" ist global und darf nur von Admins geschrieben werden`,
    )
  }

  // 2) Wenn userId gesetzt: muss dem JWT-Sub entsprechen
  if (p.userId !== null && p.userId !== benutzerId) {
    throw new ValidationError(
      'einstellung.userId',
      'Eine fremde User-ID ist nicht erlaubt',
    )
  }

  // 3) LWW-Upsert auf (key, userId)
  const incomingGeaendertAm = new Date(p.geaendertAm)
  const where = and(
    eq(einstellungen.key, p.key),
    p.userId === null
      ? isNull(einstellungen.userId)
      : eq(einstellungen.userId, p.userId),
  )
  const existing = await tx.select().from(einstellungen).where(where).limit(1)
  if (existing.length === 0) {
    await tx.insert(einstellungen).values({
      key: p.key,
      userId: p.userId,
      value: p.value,
      geaendertAm: incomingGeaendertAm,
    })
    return
  }
  // Nur überschreiben, wenn die eingehende Version neuer ist.
  // Auch hier: Drizzle-string-vs-Date normalisieren.
  const existingRow = existing[0]
  if (!existingRow) return
  const existingGeaendertAm =
    existingRow.geaendertAm instanceof Date
      ? existingRow.geaendertAm
      : new Date(existingRow.geaendertAm as unknown as string)
  if (incomingGeaendertAm.getTime() <= existingGeaendertAm.getTime()) {
    return
  }
  await tx
    .update(einstellungen)
    .set({ value: p.value, geaendertAm: incomingGeaendertAm })
    .where(where)
}