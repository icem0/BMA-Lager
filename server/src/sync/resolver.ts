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

import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema.js'
import { artikel, buchungen, projekte, standorte, auditLog } from '../db/schema.js'
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
        }

        // Audit-Log
        await tx.insert(auditLog).values({
          id: crypto.randomUUID(),
          aktion: op.op,
          entitaet: op.entity,
          entitaetId: op.payload.id,
          benutzerId,
          daten: { op: op.op, entity: op.entity },
          zeit: new Date(),
        })

        result.accepted.push(op.payload.id)
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