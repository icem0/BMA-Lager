// Reine Validatoren für Eingabeparameter der Domänen-Schicht.
// Werden von den create*-Funktionen UND direkt in Tests verwendet.

import { PflichtfeldFehltError, UngueltigeMengeError } from './errors'

export function assertMengePositiv(menge: number): void {
  if (typeof menge !== 'number' || !Number.isFinite(menge) || menge <= 0) {
    throw new UngueltigeMengeError(menge)
  }
}

export function assertPflichtfeld(name: string, value: unknown): void {
  if (value === null || value === undefined || value === '') {
    throw new PflichtfeldFehltError(name)
  }
}
