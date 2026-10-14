// Buchungs-Operationen.
// Alle Mutationen laufen in einer Dexie-Transaktion (atomic),
// damit Storno-Pointer, Paar-Ids und Audit-Log konsistent bleiben.
// Schreiboperationen befüllen zusätzlich die Outbox für den Server-Sync.

import { getDb } from '../db/database'
import type { Buchung, BuchungsEingabe, BuchungsTyp, Iso } from '../db/types'
import { jetztIso, neueUuid } from './ids'
import { queueOp } from '../services/sync/worker'
import {
  BereitsStorniertError,
  GleicherStandortError,
  NegativerBestandWarnung,
  PflichtfeldFehltError,
} from './errors'
import { assertMengePositiv, assertPflichtfeld } from './validierung'
import { berechneBestand } from './bestand'

function standardEingabeZuBuchung(
  eingabe: BuchungsEingabe,
  typ: BuchungsTyp,
  extras: Partial<Buchung> = {},
): Buchung {
  const now = jetztIso()
  return {
    id: neueUuid(),
    artikelId: eingabe.artikelId,
    standortId: eingabe.standortId,
    standortZielId: null,
    typ,
    menge: eingabe.menge,
    paarId: null,
    projekt: eingabe.projekt ?? null,
    erstelltAm: (eingabe.erstelltAm as Iso) ?? now,
    clientEingabeAm: (eingabe.clientEingabeAm as Iso) ?? now,
    erstelltVon: eingabe.erstelltVon,
    kommentar: eingabe.kommentar ?? null,
    mitteilungAn: eingabe.mitteilungAn ?? null,
    stornoVon: null,
    storno: false,
    storniertDurch: null,
    serverId: null,
    ...extras,
  }
}

async function auditSchreiben(aktion: string, eintrag: Buchung): Promise<void> {
  await getDb().auditLog.add({
    id: neueUuid(),
    aktion,
    entitaet: 'buchung',
    entitaetId: eintrag.id,
    daten: JSON.stringify(eintrag),
    zeit: jetztIso(),
  })
}

export async function createEinlagerung(eingabe: BuchungsEingabe): Promise<Buchung> {
  assertMengePositiv(eingabe.menge)
  assertPflichtfeld('artikelId', eingabe.artikelId)
  assertPflichtfeld('standortId', eingabe.standortId)
  assertPflichtfeld('erstelltVon', eingabe.erstelltVon)
  const db = getDb()
  const buchung = standardEingabeZuBuchung(eingabe, 'einlagerung')
  await db.transaction('rw', db.buchungen, db.auditLog, db.outbox, async () => {
    await db.buchungen.add(buchung)
    await queueOp('buchung', 'create', buchung)
    await auditSchreiben('createEinlagerung', buchung)
  })
  return buchung
}

export interface EntnahmeErgebnis {
  buchung: Buchung
  warnung: NegativerBestandWarnung | null
}

export async function createEntnahme(eingabe: BuchungsEingabe): Promise<EntnahmeErgebnis> {
  assertMengePositiv(eingabe.menge)
  assertPflichtfeld('artikelId', eingabe.artikelId)
  assertPflichtfeld('standortId', eingabe.standortId)
  assertPflichtfeld('erstelltVon', eingabe.erstelltVon)
  const db = getDb()

  // Bestand muss innerhalb der Transaktion berechnet werden,
  // damit er den aktuellen Stand sieht.
  let warnung: NegativerBestandWarnung | null = null
  const buchung = standardEingabeZuBuchung(eingabe, 'entnahme', { menge: -eingabe.menge })

  await db.transaction('rw', db.buchungen, db.auditLog, db.outbox, async () => {
    const aktuelle = await db.buchungen.where('artikelId').equals(eingabe.artikelId).toArray()
    const bestand = berechneBestand(aktuelle, eingabe.standortId)
    if (bestand < eingabe.menge) {
      warnung = new NegativerBestandWarnung(
        eingabe.artikelId,
        eingabe.standortId,
        bestand,
        eingabe.menge,
      )
    }
    await db.buchungen.add(buchung)
    await queueOp('buchung', 'create', buchung)
    await auditSchreiben('createEntnahme', buchung)
  })
  return { buchung, warnung }
}

export interface UmlagerungEingabe {
  artikelId: string
  vonId: string
  nachId: string
  menge: number
  erstelltVon: string
  projekt?: string | null
  kommentar?: string | null
  erstelltAm?: Iso
  clientEingabeAm?: Iso
}

export interface UmlagerungErgebnis {
  entnahme: Buchung
  einlagerung: Buchung
  paarId: string
  warnung: NegativerBestandWarnung | null
}

export async function createUmlagerung(e: UmlagerungEingabe): Promise<UmlagerungErgebnis> {
  assertMengePositiv(e.menge)
  assertPflichtfeld('artikelId', e.artikelId)
  assertPflichtfeld('vonId', e.vonId)
  assertPflichtfeld('nachId', e.nachId)
  assertPflichtfeld('erstelltVon', e.erstelltVon)
  if (e.vonId === e.nachId) throw new GleicherStandortError()

  const db = getDb()
  const paarId = neueUuid()
  const now = jetztIso()
  const entnahme: Buchung = {
    id: neueUuid(),
    artikelId: e.artikelId,
    standortId: e.vonId,
    standortZielId: e.nachId,
    typ: 'umlagerung',
    menge: -e.menge,
    paarId,
    projekt: e.projekt ?? null,
    erstelltAm: (e.erstelltAm as Iso) ?? now,
    clientEingabeAm: (e.clientEingabeAm as Iso) ?? now,
    erstelltVon: e.erstelltVon,
    kommentar: e.kommentar ?? null,
    mitteilungAn: null,
    stornoVon: null,
    storno: false,
    storniertDurch: null,
    serverId: null,
  }
  const einlagerung: Buchung = { ...entnahme, id: neueUuid(), standortId: e.nachId, menge: e.menge }
  let warnung: NegativerBestandWarnung | null = null

  await db.transaction('rw', db.buchungen, db.auditLog, db.outbox, async () => {
    const aktuelle = await db.buchungen.where('artikelId').equals(e.artikelId).toArray()
    const bestand = berechneBestand(aktuelle, e.vonId)
    if (bestand < e.menge) {
      warnung = new NegativerBestandWarnung(e.artikelId, e.vonId, bestand, e.menge)
    }
    await db.buchungen.bulkAdd([entnahme, einlagerung])
    await Promise.all([
      queueOp('buchung', 'create', entnahme),
      queueOp('buchung', 'create', einlagerung),
    ])
    await auditSchreiben('createUmlagerung.entnahme', entnahme)
    await auditSchreiben('createUmlagerung.einlagerung', einlagerung)
  })
  return { entnahme, einlagerung, paarId, warnung }
}

export interface InventurEingabe {
  artikelId: string
  standortId: string
  sollMenge: number
  erstelltVon: string
  kommentar?: string | null
  erstelltAm?: Iso
  clientEingabeAm?: Iso
}

export interface InventurErgebnis {
  buchung: Buchung
  differenz: number
  vorher: number
}

export async function createInventur(e: InventurEingabe): Promise<InventurErgebnis> {
  if (typeof e.sollMenge !== 'number' || !Number.isFinite(e.sollMenge) || e.sollMenge < 0) {
    throw new PflichtfeldFehltError('sollMenge (>= 0)')
  }
  assertPflichtfeld('artikelId', e.artikelId)
  assertPflichtfeld('standortId', e.standortId)
  assertPflichtfeld('erstelltVon', e.erstelltVon)
  const db = getDb()
  const now = jetztIso()
  let vorher = 0
  let differenz = 0
  const buchung: Buchung = {
    id: neueUuid(),
    artikelId: e.artikelId,
    standortId: e.standortId,
    standortZielId: null,
    typ: 'inventur',
    menge: 0, // wird unten gesetzt
    paarId: null,
    projekt: null,
    erstelltAm: (e.erstelltAm as Iso) ?? now,
    clientEingabeAm: (e.clientEingabeAm as Iso) ?? now,
    erstelltVon: e.erstelltVon,
    kommentar: e.kommentar ?? null,
    mitteilungAn: null,
    stornoVon: null,
    storno: false,
    storniertDurch: null,
    serverId: null,
  }
  await db.transaction('rw', db.buchungen, db.auditLog, db.outbox, async () => {
    const aktuelle = await db.buchungen.where('artikelId').equals(e.artikelId).toArray()
    vorher = berechneBestand(aktuelle, e.standortId)
    differenz = e.sollMenge - vorher
    buchung.menge = differenz
    await db.buchungen.add(buchung)
    await queueOp('buchung', 'create', buchung)
    await auditSchreiben('createInventur', buchung)
  })
  return { buchung, differenz, vorher }
}

export interface KommissionEingabe {
  /** ID der Buchung, deren Projekt umgeschrieben werden soll */
  buchungId: string
  neuesProjekt: string
  erstelltVon: string
  kommentar?: string | null
}

export interface KommissionErgebnis {
  storno: Buchung
  neubuchung: Buchung
}

/**
 * Kommission: Original-Buchung wird storniert, eine neue Buchung mit
 * identischer Menge (gleiches Vorzeichen) am gleichen Standort und
 * mit neuem Projekt wird angelegt. Bestand bleibt konstant.
 */
export async function createKommission(e: KommissionEingabe): Promise<KommissionErgebnis> {
  assertPflichtfeld('buchungId', e.buchungId)
  assertPflichtfeld('neuesProjekt', e.neuesProjekt)
  assertPflichtfeld('erstelltVon', e.erstelltVon)
  const db = getDb()
  const now = jetztIso()
  const storno: Buchung = {
    id: neueUuid(),
    artikelId: '',
    standortId: '',
    standortZielId: null,
    typ: 'storno',
    menge: 0,
    paarId: null,
    projekt: null,
    erstelltAm: now,
    clientEingabeAm: now,
    erstelltVon: e.erstelltVon,
    kommentar: e.kommentar ?? null,
    mitteilungAn: null,
    stornoVon: e.buchungId,
    // Storno-Buchungen zählen NICHT in den Bestand (sie stornieren sich paarweise mit dem Original aus).
    storno: true,
    storniertDurch: null,
    serverId: null,
  }
  const neubuchung: Buchung = {
    id: neueUuid(),
    artikelId: '',
    standortId: '',
    standortZielId: null,
    typ: 'kommission',
    menge: 0,
    paarId: null,
    projekt: e.neuesProjekt,
    erstelltAm: now,
    clientEingabeAm: now,
    erstelltVon: e.erstelltVon,
    kommentar: e.kommentar ?? null,
    mitteilungAn: null,
    stornoVon: null,
    storno: false,
    storniertDurch: null,
    serverId: null,
  }
  await db.transaction('rw', db.buchungen, db.auditLog, db.outbox, async () => {
    const original = await db.buchungen.get(e.buchungId)
    if (!original) throw new PflichtfeldFehltError('buchungId (nicht gefunden)')
    if (original.storno) throw new BereitsStorniertError(e.buchungId)
    if (original.typ === 'storno' || original.typ === 'kommission') {
      throw new PflichtfeldFehltError('buchungId (kein umbuchbares Original)')
    }
    storno.artikelId = original.artikelId
    storno.standortId = original.standortId
    storno.standortZielId = original.standortZielId
    storno.menge = -original.menge
    neubuchung.artikelId = original.artikelId
    neubuchung.standortId = original.standortId
    neubuchung.standortZielId = original.standortZielId
    neubuchung.menge = original.menge

    // Original markieren
    original.storno = true
    original.storniertDurch = storno.id
    await db.buchungen.put(original)
    await db.buchungen.bulkAdd([storno, neubuchung])
    await Promise.all([
      queueOp('buchung', 'create', storno),
      queueOp('buchung', 'create', neubuchung),
    ])
    await auditSchreiben('createKommission.storno', storno)
    await auditSchreiben('createKommission.neubuchung', neubuchung)
  })
  return { storno, neubuchung }
}

export interface StornoEingabe {
  buchungId: string
  grund: string
  erstelltVon: string
}

export interface StornoErgebnis {
  storno: Buchung
  original: Buchung
}

/**
 * Storniert eine Buchung. Erzeugt eine storno-Buchung mit invertierter Menge,
 * setzt storno=true und storniertDurch am Original.
 * Doppelstornos werfen BereitsStorniertError.
 */
export async function stornieren(e: StornoEingabe): Promise<StornoErgebnis> {
  assertPflichtfeld('buchungId', e.buchungId)
  assertPflichtfeld('grund', e.grund)
  assertPflichtfeld('erstelltVon', e.erstelltVon)
  const db = getDb()
  const now = jetztIso()
  const storno: Buchung = {
    id: neueUuid(),
    artikelId: '',
    standortId: '',
    standortZielId: null,
    typ: 'storno',
    menge: 0,
    paarId: null,
    projekt: null,
    erstelltAm: now,
    clientEingabeAm: now,
    erstelltVon: e.erstelltVon,
    kommentar: e.grund,
    mitteilungAn: null,
    stornoVon: e.buchungId,
    // Storno-Buchungen zählen NICHT in den Bestand (paarweise mit Original, beide stornieren sich aus).
    storno: true,
    storniertDurch: null,
    serverId: null,
  }
  let original!: Buchung
  await db.transaction('rw', db.buchungen, db.auditLog, db.outbox, async () => {
    const orig = await db.buchungen.get(e.buchungId)
    if (!orig) throw new PflichtfeldFehltError('buchungId (nicht gefunden)')
    if (orig.storno) throw new BereitsStorniertError(e.buchungId)
    if (orig.typ === 'storno') {
      throw new PflichtfeldFehltError('buchungId (eine Storno-Buchung kann nicht storniert werden)')
    }
    original = orig
    storno.artikelId = orig.artikelId
    storno.standortId = orig.standortId
    storno.standortZielId = orig.standortZielId
    storno.menge = -orig.menge
    orig.storno = true
    orig.storniertDurch = storno.id
    await db.buchungen.put(orig)
    await db.buchungen.add(storno)
    await queueOp('buchung', 'create', storno)
    await auditSchreiben('stornieren', storno)
  })
  return { storno, original }
}
