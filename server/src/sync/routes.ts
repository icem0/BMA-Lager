// Sync-Routes: GET /api/sync/snapshot, GET /api/sync/status, POST /api/sync/push.

import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { artikel, buchungen, projekte, standorte } from '../db/schema.js'
import { pushPayloadSchema, snapshotQuerySchema } from '../domain/validierung.js'
import { resolvePush } from './resolver.js'

async function countRows(db: ReturnType<typeof getDb>): Promise<{
  artikel: number
  standorte: number
  projekte: number
  buchungen: number
}> {
  const [a, s, p, b] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(artikel),
    db.select({ c: sql<number>`count(*)::int` }).from(standorte),
    db.select({ c: sql<number>`count(*)::int` }).from(projekte),
    db.select({ c: sql<number>`count(*)::int` }).from(buchungen),
  ])
  return {
    artikel: a[0]?.c ?? 0,
    standorte: s[0]?.c ?? 0,
    projekte: p[0]?.c ?? 0,
    buchungen: b[0]?.c ?? 0,
  }
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /api/sync/snapshot?since=<iso> ----------
  app.get<{ Querystring: { since?: string } }>(
    '/api/sync/snapshot',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const parsed = snapshotQuerySchema.safeParse(req.query)
      if (!parsed.success) {
        return reply.code(400).send({ code: 'VALIDATION', issues: parsed.error.issues })
      }
      const since = parsed.data.since ? new Date(parsed.data.since) : new Date(0)
      const db = getDb()

      const [artikelRows, standortRows, projektRows, buchungRows] = await Promise.all([
        db.select().from(artikel).where(sql`${artikel.geaendertAm} > ${since}`),
        db.select().from(standorte).where(sql`${standorte.geaendertAm} > ${since}`),
        db.select().from(projekte).where(sql`${projekte.geaendertAm} > ${since}`),
        db.select().from(buchungen).where(sql`${buchungen.erstelltAm} > ${since}`),
      ])

      return reply.send({
        serverTime: new Date().toISOString(),
        since: since.toISOString(),
        artikel: artikelRows,
        standorte: standortRows,
        projekte: projektRows,
        buchungen: buchungRows,
      })
    },
  )

  // ---------- GET /api/sync/status ----------
  // Liefert Server-Zeit + Row-Counts pro Tabelle. Wird vom Client genutzt,
  // um die Divergenz zwischen lokaler IndexedDB und Postgres anzuzeigen.
  app.get(
    '/api/sync/status',
    { preHandler: app.requireAuth },
    async (_req, reply) => {
      const db = getDb()
      const counts = await countRows(db)
      return reply.send({
        serverTime: new Date().toISOString(),
        counts,
      })
    },
  )

  // ---------- POST /api/sync/push ----------
  app.post(
    '/api/sync/push',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const parsed = pushPayloadSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(400).send({ code: 'VALIDATION', issues: parsed.error.issues })
      }
      const user = req.authUser
      if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED' })

      const db = getDb()
      const result = await resolvePush(db, parsed.data.ops, user.sub)

      return reply.send(result)
    },
  )
}