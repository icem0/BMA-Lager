// Bestandsberechnung.
// Kernregel aus AGENTS.md: Bestand ist die Summe der Buchungen.
// Stornierte Buchungen zählen nicht (storno = true).

import type { Buchung } from '../db/types'

/**
 * Bestand eines Artikels an einem Standort.
 * Zählt nur nicht-stornierte Buchungen. Bei umlagerung trägt die entnahme
 * die negative Menge an der Quelle, die einlagerung die positive am Ziel.
 * Inventur-Buchungen sind bereits als Differenz (soll - bestand) kodiert.
 */
export function berechneBestand(buchungen: Buchung[], standortId: string): number {
  let summe = 0
  for (const b of buchungen) {
    if (b.storno) continue
    if (b.standortId === standortId) summe += b.menge
  }
  return summe
}

/**
 * Bestand eines Artikels aufgeschlüsselt nach Standort.
 */
export function berechneBestandProStandort(buchungen: Buchung[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const b of buchungen) {
    if (b.storno) continue
    map.set(b.standortId, (map.get(b.standortId) ?? 0) + b.menge)
  }
  return map
}

/**
 * Summe aller (nicht-stornierten) Buchungen — nützlich für Inventur-Differenzen.
 */
export function summeAktiveBuchungen(buchungen: Buchung[]): number {
  return buchungen.filter((b) => !b.storno).reduce((s, b) => s + b.menge, 0)
}
