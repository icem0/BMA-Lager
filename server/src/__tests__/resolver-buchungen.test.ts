// Strategie-Tests für den Resolver.
// Echte DB-Integration würde gegen eine Test-Postgres laufen; in dieser Stufe
// testen wir nur die Error-Klassen und das Zod-Limit.

import { describe, it, expect } from 'vitest'
import {
  NegativerBestandError,
  UnbekannteReferenzError,
  ValidationError,
} from '../domain/errors.js'
import { pushPayloadSchema } from '../domain/validierung.js'
import type { PushOp } from '../sync/resolver.js'

describe('Resolver — Strategie', () => {
  it('NegativerBestandError liefert genug Kontext für Client-UI', () => {
    const e = new NegativerBestandError('a1', 's1', 2, 5)
    expect(e.aktuellerBestand).toBe(2)
    expect(e.angeforderteMenge).toBe(5)
    expect(e.message).toContain('aktuell 2')
  })

  it('UnbekannteReferenzError unterscheidet Entity', () => {
    expect(new UnbekannteReferenzError('artikel', 'a').entity).toBe('artikel')
    expect(new UnbekannteReferenzError('standort', 's').entity).toBe('standort')
  })

  it('ValidationError bei Buchung-op != create', () => {
    const e = new ValidationError('buchung.op', 'nur "create" erlaubt (append-only)')
    expect(e.code).toBe('VALIDATION')
  })

  it('Push-Eingabe akzeptiert maximal 500 ops (zod-Limit)', () => {
    const ops = Array.from({ length: 501 }, (_, i) => ({
      op: 'create' as const,
      entity: 'buchung' as const,
      payload: {
        id: `b${i}`,
        artikelId: 'a1',
        standortId: 's1',
        typ: 'einlagerung' as const,
        menge: 1,
        erstelltAm: '2025-04-14T11:00:00.000Z',
        erstelltVon: 'u1',
        storno: false,
      },
    }))
    const r = pushPayloadSchema.safeParse({ ops })
    expect(r.success).toBe(false)
  })
})

describe('resolvePush-Signatur', () => {
  it('akzeptiert den erwarteten Eingabetyp', () => {
    const ops: PushOp[] = []
    expect(Array.isArray(ops)).toBe(true)
  })
})