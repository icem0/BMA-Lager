// Sync-Routes: GET /api/sync/snapshot, POST /api/sync/push.

import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { getDb } from '../db/client.js'
import { artikel, buchungen, projekte, standorte } from '../db/schema.js'
import { pushPayloadSchema, snapshotQuerySchema } from '../domain/validierung.js'
import { resolvePush } from './resolver.js'

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