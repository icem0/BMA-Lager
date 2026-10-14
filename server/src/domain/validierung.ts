// Gemeinsame Validierungs- und Transformations-Helfer für eingehende
// API-Payloads. Wir nutzen zod-Schemas, damit Frontend (PWA) und Backend
// sich an dieselben Verträge halten können.

import { z } from 'zod'

// ---------- ISO-Datumsformat ----------
// Server akzeptiert ISO-8601 UTC, normalisiert aber beim Schreiben in TIMESTAMPTZ.

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: 'muss ISO-8601-Datum sein',
})

// ---------- IDs ----------

const id = z.string().min(1, 'ID erforderlich')

// ---------- Stammdaten ----------

export const artikelSchema = z.object({
  id,
  sharePointId: z.number().int().nullable().optional(),
  titel: z.string().min(1),
  status: z.enum(['verfuegbar', 'reserviert', 'gesperrt', 'ausgesondert', 'archiviert']),
  typ: z.string(),
  lieferant: z.string().nullable().optional(),
  verpackungseinheit: z.number().int().positive(),
  mindestbestand: z.number().int().nullable().optional(),
  nachbestellHinweis: z.enum(['i.O', 'bald', 'dringend']).nullable().optional(),
  bestellnummer: z.string().nullable().optional(),
  listenpreis: z.number().int().nullable().optional(),
  geaendertAm: iso,
  erstelltAm: iso,
})

export const standortSchema = z.object({
  id,
  name: z.string().min(1),
  typ: z.enum(['lager', 'auto', 'baustelle', 'extern']),
  projekt: z.string().nullable().optional(),
  kennzeichen: z.string().nullable().optional(),
  standard: z.boolean(),
  archiviert: z.boolean(),
  geaendertAm: iso,
  erstelltAm: iso,
})

export const projektSchema = z.object({
  id,
  nummer: z.string().min(1),
  name: z.string().nullable().optional(),
  archiviert: z.boolean(),
  geaendertAm: iso,
  erstelltAm: iso,
})

export const buchungSchema = z.object({
  id,
  artikelId: id,
  standortId: id,
  standortZielId: id.nullable().optional(),
  typ: z.enum(['einlagerung', 'entnahme', 'umlagerung', 'inventur', 'kommission', 'storno']),
  menge: z.number().int(),
  paarId: z.string().nullable().optional(),
  projekt: z.string().nullable().optional(),
  erstelltAm: iso,
  clientEingabeAm: iso.nullable().optional(),
  erstelltVon: id,
  kommentar: z.string().nullable().optional(),
  mitteilungAn: z.string().nullable().optional(),
  stornoVon: z.string().nullable().optional(),
  storno: z.boolean(),
  storniertDurch: z.string().nullable().optional(),
})

// ---------- Sync-Push ----------

export const pushPayloadSchema = z.object({
  // Liste der Outbox-Items, die der Client hochlädt.
  // Wir nutzen ein diskriminiertes Union pro Entity-Typ.
  ops: z
    .array(
      z.discriminatedUnion('entity', [
        z.object({
          op: z.enum(['create', 'update', 'delete']),
          entity: z.literal('artikel'),
          payload: artikelSchema,
        }),
        z.object({
          op: z.enum(['create', 'update', 'delete']),
          entity: z.literal('standort'),
          payload: standortSchema,
        }),
        z.object({
          op: z.enum(['create', 'update', 'delete']),
          entity: z.literal('projekt'),
          payload: projektSchema,
        }),
        z.object({
          op: z.literal('create'), // Buchungen sind append-only: nur create
          entity: z.literal('buchung'),
          payload: buchungSchema,
        }),
      ]),
    )
    .max(500, 'maximal 500 ops pro Push'),
})

// ---------- Auth ----------

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben'),
  rolle: z.enum(['admin', 'user']).default('user'),
})

export const patchUserSchema = z.object({
  rolle: z.enum(['admin', 'user']).optional(),
  aktiv: z.boolean().optional(),
  password: z.string().min(8).optional(),
})

/**
 * Initial-Setup: legt den allerersten User an. Darf nur aufgerufen werden,
 * solange noch kein User in der DB existiert — der Server prüft das.
 */
export const setupSchema = z.object({
  anzeigename: z.string().min(1, 'Anzeigename ist erforderlich').max(120),
  email: z.string().email(),
  passwort: z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben'),
})

// ---------- Snapshot-Query ----------

export const snapshotQuerySchema = z.object({
  since: iso.optional(),
})