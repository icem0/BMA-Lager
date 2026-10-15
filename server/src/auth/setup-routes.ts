// Setup-Endpoints: GET /api/auth/setup-status und POST /api/auth/setup.
//
// GET: meldet der Login-View, ob bereits ein User existiert.
//      - Erfordert keine Authentifizierung.
//      - Antwort: { setupRequired: boolean, userCount: number }
//
// POST: legt den allerersten User (Admin) an.
//      - Erfordert keine Authentifizierung.
//      - Weigert sich, wenn bereits ein User existiert (409 SETUP_DONE).
//      - Setzt mustChangePassword=false (der User hat das PW ja gerade selbst
//        vergeben — es gibt nichts mehr zu wechseln).
//      - Legt im selben Request zusätzlich das Hauptlager (Standard-Standort)
//        und 5 Test-Artikel an — siehe `bootstrapHauptlager`. Beides ist
//        idempotent: Wenn bereits ein Standard-Standort existiert, wird der
//        Bootstrap stillschweigend übersprungen.
//      - Persistiert die gewählte Sprache als `einstellungen`-Eintrag des
//        Users (pro-User, LWW).
//      - Antwort: UserDto. Login läuft danach normal via /api/auth/login.

import type { FastifyInstance } from 'fastify'
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { getDb } from '../db/client.js'
import { artikel, einstellungen, standorte, users } from '../db/schema.js'
import type * as schema from '../db/schema.js'
import {
  bootstrapInhalt,
  setupSchema,
  type BootstrapInhalt,
} from '../domain/validierung.js'

const HAUPTLAGER_TYP = 'lager' as const

export interface BootstrapResult {
  uebersprungen: boolean
  hauptlagerId?: string
  testArtikelIds: string[]
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /api/auth/setup-status ----------
  app.get('/api/auth/setup-status', async (_req, reply) => {
    const db = getDb()
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .limit(1)
    return reply.send({ setupRequired: rows.length === 0, userCount: rows.length === 0 ? 0 : 1 })
  })

  // ---------- POST /api/auth/setup ----------
  app.post('/api/auth/setup', async (req, reply) => {
    const parsed = setupSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION', issues: parsed.error.issues })
    }
    const { anzeigename, email, passwort, sprache } = parsed.data
    const normalizedEmail = email.toLowerCase()
    const db = getDb()

    // Idempotenz-Garantie: verweigern, sobald ein User existiert.
    const existing = await db.select({ id: users.id }).from(users).limit(1)
    if (existing.length > 0) {
      return reply.code(409).send({
        code: 'SETUP_DONE',
        message: 'Es existiert bereits ein User. Bitte direkt anmelden.',
      })
    }

    // Doppelte E-Mail (defensiv — der Limit-1-Check oben fängt es eigentlich
    // schon ab, aber wenn zwischenzeitlich ein zweiter User angelegt wurde,
    // wären wir hier unsicher).
    const dup = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1)
    if (dup.length > 0) {
      return reply.code(409).send({ code: 'EMAIL_TAKEN', message: 'E-Mail bereits vergeben' })
    }

    const id = crypto.randomUUID()
    const passwordHash = await argon2.hash(passwort, { type: argon2.argon2id })
    const inhalt = bootstrapInhalt(sprache)

    // Atomar: User → Einstellung(sprache) → Standard-Standort → Test-Artikel.
    // Wenn eine der Operationen fehlschlägt, wird nichts persistiert.
    const bootstrap = await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id,
        email: normalizedEmail,
        passwordHash,
        rolle: 'admin',
        aktiv: true,
        erstelltAm: new Date(),
        letzterLoginAm: null,
        mustChangePassword: false,
        anzeigename: anzeigename.trim(),
      })

      // Pro-User-Spracheinstellung (Cross-Device-Sync). LWW über geaendert_am.
      await tx.insert(einstellungen).values({
        key: 'sprache',
        userId: id,
        value: sprache,
        geaendertAm: new Date(),
      })

      return bootstrapHauptlager(tx, inhalt)
    })

    return reply.code(201).send({
      id,
      email: normalizedEmail,
      anzeigename: anzeigename.trim(),
      rolle: 'admin' as const,
      aktiv: true,
      sprache,
      bootstrap: {
        hauptlager: inhalt.hauptlagerName,
        testArtikel: bootstrap.uebersprungen ? 0 : bootstrap.testArtikelIds.length,
        uebersprungen: bootstrap.uebersprungen,
      },
    })
  })
}

/**
 * Legt das Hauptlager (Standard-Standort) und 5 Test-Artikel an — sofern
 * noch kein Standard-Standort existiert. Idempotent: zweiter Aufruf in
 * derselben Transaktion oder nach einem Retry tut nichts.
 *
 * Extracted as a pure DB-bound function so that unit tests can drive it
 * with a thin in-memory shim.
 */
export async function bootstrapHauptlager(
  tx: PostgresJsDatabase<typeof schema>,
  inhalt: BootstrapInhalt,
): Promise<BootstrapResult> {
  const bestehende = await tx
    .select({ id: standorte.id })
    .from(standorte)
    .where(eq(standorte.standard, true))
    .limit(1)
  if (bestehende.length > 0) {
    return { uebersprungen: true, testArtikelIds: [] }
  }

  const hauptlager = buildHauptlager(inhalt)
  await tx.insert(standorte).values(hauptlager)

  const testArtikel = buildTestArtikel(inhalt)
  if (testArtikel.length > 0) {
    await tx.insert(artikel).values(testArtikel)
  }

  return {
    uebersprungen: false,
    hauptlagerId: hauptlager.id,
    testArtikelIds: testArtikel.map((a) => a.id),
  }
}

function buildHauptlager(inhalt: BootstrapInhalt) {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    name: inhalt.hauptlagerName,
    typ: HAUPTLAGER_TYP,
    projekt: null,
    kennzeichen: null,
    standard: true,
    archiviert: false,
    geaendertAm: now,
    erstelltAm: now,
  }
}

function buildTestArtikel(inhalt: BootstrapInhalt) {
  const now = new Date()
  return inhalt.testArtikel.map((a) => ({
    id: crypto.randomUUID(),
    sharePointId: null,
    titel: a.titel,
    status: 'verfuegbar' as const,
    typ: a.typ,
    lieferant: null,
    verpackungseinheit: a.verpackungseinheit,
    mindestbestand: a.mindestbestand,
    nachbestellHinweis: null,
    bestellnummer: null,
    listenpreis: null,
    geaendertAm: now,
    erstelltAm: now,
    archiviert: false,
  }))
}

// Test-Hooks (nicht Teil der oeffentlichen API): exportiert fuer Unit-Tests.
export const __test__ = { buildHauptlager, buildTestArtikel, HAUPTLAGER_TYP }

