// Bestandsformel: Σ buchungen.menge where storno=false und (Standort passt).
//
// Diese Funktion läuft in Postgres als SQL. Wir spiegeln die Logik
// aus src/domain/bestand.ts der PWA (PLAN §4, "Bestandsformel").
//
// Wichtig: Das ist eine read-only-Funktion — Validierung + Schreiben
// passieren in der Sync-Resolver-Logik (siehe src/sync/resolver.ts).

import { sql, eq, and, or } from 'drizzle-orm'
import { buchungen } from '../db/schema.js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '../db/schema.js'

export interface BestandResult {
  artikelId: string
  standortId: string
  menge: number
}

/**
 * Bestand für einen Artikel an einem Standort.
 *
 * Modellierung (PLAN §4):
 *   * einlagerung / entnahme / inventur / kommission / storno
 *     → haben nur `standortId`; Menge positiv oder negativ.
 *   * umlagerung
 *     → als zwei Buchungen mit gleicher `paarId` gespeichert:
 *       - entnahme am Quellstandort mit negativer Menge (`standortId = von`)
 *       - einlagerung am Zielstandort mit positiver Menge (`standortId = nach`,
 *         `standortZielId = von`)
 *
 * Daher reicht die einfache Summe: alle Buchungen, deren `standortId = s`
 * (oder — für Umlagerungen — `standortZielId = s`, da dort die Buchung
 * den Quellstandort als Ziel referenziert). Das ist semantisch identisch
 * zu "standortId = s ODER (typ='umlagerung' UND standortZielId = s)".
 *
 * Negativ ist erlaubt (zeigt die Konflikt-Situation nach Offline-Buchungen);
 * der Sync-Resolver lehnt das beim Push ab.
 */
export async function berechneBestand(
  db: PostgresJsDatabase<typeof schema>,
  artikelId: string,
  standortId: string,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${buchungen.menge}), 0)::int` })
    .from(buchungen)
    .where(
      and(
        eq(buchungen.artikelId, artikelId),
        eq(buchungen.storno, false),
        or(
          eq(buchungen.standortId, standortId),
          and(eq(buchungen.typ, 'umlagerung'), eq(buchungen.standortZielId, standortId)),
        ),
      ),
    )
  return rows[0]?.total ?? 0
}

/**
 * Liste aller Bestände für einen Artikel (gruppiert nach Standort).
 * Wird im Snapshot-Endpoint und fürs Push-Audit benutzt.
 */
export async function berechneBestaendeProArtikel(
  db: PostgresJsDatabase<typeof schema>,
  artikelId: string,
): Promise<BestandResult[]> {
  // Wir nutzen ein UNION-ähnliches Konstrukt: alle Standort-IDs aus
  // (standortId, standortZielId), dann pro Standort die Summe.
  // Vereinfachung: wir holen erst alle relevanten Standort-IDs.
  const idsRows = await db
    .selectDistinct({
      sid: sql<string>`${buchungen.standortId}`,
    })
    .from(buchungen)
    .where(and(eq(buchungen.artikelId, artikelId), eq(buchungen.storno, false)))

  const zielRows = await db
    .selectDistinct({ sid: sql<string>`${buchungen.standortZielId}` })
    .from(buchungen)
    .where(
      and(
        eq(buchungen.artikelId, artikelId),
        eq(buchungen.storno, false),
        eq(buchungen.typ, 'umlagerung'),
      ),
    )

  const alle = new Set<string>()
  for (const r of idsRows) if (r.sid) alle.add(r.sid)
  for (const r of zielRows) if (r.sid) alle.add(r.sid)

  const results: BestandResult[] = []
  for (const sid of alle) {
    const menge = await berechneBestand(db, artikelId, sid)
    results.push({ artikelId, standortId: sid, menge })
  }
  return results
}