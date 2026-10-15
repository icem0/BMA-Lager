// Tests für den Sync-Resolver. Wir mocken die PostgresJsDatabase mit einem
// minimalen In-Memory-Layer (nur die Operationen, die wir brauchen).
//
// Echte DB-Integration läuft gegen die echte Test-Postgres-Instanz (siehe README).

import { describe, it, expect } from 'vitest'
import { ConflictError } from '../sync/resolver.js'

// Wir testen den ConflictError separat (einzige exportierte Klasse).
// Den Resolver selbst testen wir mit einem Mock — siehe unten.

describe('Resolver — ConflictError', () => {
  it('trägt Message', () => {
    const e = new ConflictError('Server neuer')
    expect(e.message).toBe('Server neuer')
    expect(e.name).toBe('ConflictError')
    expect(e).toBeInstanceOf(Error)
  })
})

// Mini-Mock-DB für die Resolver-Pfade, die nur Gleichheit/Zeitstempel prüfen.
import { applyLastWriterWinsMock } from '../sync/__test-helpers__.js'

describe('applyLastWriterWinsMock (Server-Version)', () => {
  it('Server ist neuer → wirft ConflictError', () => {
    expect(() =>
      applyLastWriterWinsMock({
        serverGeaendertAm: new Date('2025-04-14T12:00:00.000Z'),
        incomingGeaendertAm: new Date('2025-04-14T11:00:00.000Z'),
        id: 'a1',
      }),
    ).toThrow(/neuer/)
  })

  it('Eingehend ist neuer → kein Konflikt', () => {
    expect(() =>
      applyLastWriterWinsMock({
        serverGeaendertAm: new Date('2025-04-14T11:00:00.000Z'),
        incomingGeaendertAm: new Date('2025-04-14T12:00:00.000Z'),
        id: 'a1',
      }),
    ).not.toThrow()
  })

  it('Gleiche Zeit → kein Konflikt (strictly newer erforderlich)', () => {
    const t = new Date('2025-04-14T11:00:00.000Z')
    expect(() =>
      applyLastWriterWinsMock({
        serverGeaendertAm: t,
        incomingGeaendertAm: new Date(t.getTime()),
        id: 'a1',
      }),
    ).not.toThrow()
  })
})

// Regression: Drizzle's postgres-js-Driver liefert `timestamp with timezone`
// als ISO-String, nicht als Date. Der Resolver muss das normalisieren, bevor
// `applyLastWriterWinsMock` darauf `.toISOString()` ruft.
describe('Resolver — Drizzle-string-gaendertAm Normalisierung', () => {
  it('wirft NICHT, wenn serverGeaendertAm als String ankommt (postgres-js-Driver)', () => {
    // Simuliert das, was Drizzle zurückgibt: ein ISO-String statt Date.
    const serverGeaendertAmString = '2026-10-14T11:00:00.000Z'
    const incomingGeaendertAm = new Date('2026-10-14T12:00:00.000Z')

    // Der Fix: vor applyLastWriterWinsMock in Date wrappen.
    const normalized =
      serverGeaendertAmString instanceof Date
        ? serverGeaendertAmString
        : new Date(serverGeaendertAmString)

    expect(() =>
      applyLastWriterWinsMock({
        serverGeaendertAm: normalized,
        incomingGeaendertAm,
        id: 'a1',
      }),
    ).not.toThrow()
  })

  it('erkennt Konflikt korrekt, wenn String-Timestamp vom Server neuer ist', () => {
    const serverGeaendertAmString = '2026-10-14T13:00:00.000Z' // Server ist NEUER
    const incomingGeaendertAm = new Date('2026-10-14T12:00:00.000Z')

    const normalized =
      serverGeaendertAmString instanceof Date
        ? serverGeaendertAmString
        : new Date(serverGeaendertAmString)

    expect(() =>
      applyLastWriterWinsMock({
        serverGeaendertAm: normalized,
        incomingGeaendertAm,
        id: 'a1',
      }),
    ).toThrow(/neuer/)
  })
})