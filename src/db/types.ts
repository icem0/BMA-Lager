// Domänen-Typen für bma-lager.
// Quelle der Wahrheit: PLAN.md §4.
// Alle Entitäten haben `id: string` (UUID via crypto.randomUUID()).
// Buchungen sind append-only (id + erstelltAm sind unveränderlich).

export type Iso = string // ISO-8601 UTC, z. B. "2025-04-14T11:17:49.000Z"

export type ArtikelStatus = 'verfuegbar' | 'reserviert' | 'gesperrt' | 'ausgesondert'
export type NachbestellHinweis = 'i.O' | 'bald' | 'dringend' | null
export type StandortTyp = 'lager' | 'auto' | 'baustelle' | 'extern'
export type BuchungsTyp =
  'einlagerung' | 'entnahme' | 'umlagerung' | 'inventur' | 'kommission' | 'storno'

export interface Artikel {
  id: string
  sharePointId: number | null
  foto: string | null
  titel: string
  status: ArtikelStatus
  typ: string
  lieferant: string | null
  verpackungseinheit: number
  mindestbestand: number | null
  nachbestellHinweis: NachbestellHinweis
  bestellnummer: string | null
  listenpreis: number | null
  geaendertAm: Iso | null
  erstelltAm: Iso
  archiviert: boolean
}

export interface Standort {
  id: string
  name: string
  typ: StandortTyp
  projekt: string | null
  kennzeichen: string | null
  standard: boolean
  archiviert: boolean
}

export interface Buchung {
  id: string
  artikelId: string
  standortId: string
  standortZielId: string | null // nur bei umlagerung
  typ: BuchungsTyp
  /** Signed Menge. inventur = soll - bestand. */
  menge: number
  /** identische paarId auf entnahme + einlagerung bei umlagerung */
  paarId: string | null
  projekt: string | null
  /** Buchungsdatum (zeitliche Reihenfolge der Bewegung) */
  erstelltAm: Iso
  /** Erfassungszeitpunkt in der UI */
  clientEingabeAm: Iso
  erstelltVon: string
  kommentar: string | null
  mitteilungAn: string | null
  /** gesetzt auf storno-Buchungen: referenziert die stornierte Original-Buchung */
  stornoVon: string | null
  /** Schnellfilter: ist die Original-Buchung storniert? */
  storno: boolean
  /** Back-Ref: welche Storno-Buchung hat das Original storniert? */
  storniertDurch: string | null
}

export interface Projekt {
  id: string
  nummer: string
  name: string | null
  archiviert: boolean
}

export interface Einstellung {
  key: string
  value: string
}

export interface AuditLogEintrag {
  id: string
  aktion: string
  entitaet: 'artikel' | 'standort' | 'buchung' | 'projekt' | 'einstellung'
  entitaetId: string
  daten: string // JSON-serialisiert
  zeit: Iso
}

/** Eingabe-Parameter für createEinlagerung / createEntnahme */
export interface BuchungsEingabe {
  artikelId: string
  standortId: string
  menge: number
  projekt?: string | null
  erstelltVon: string
  kommentar?: string | null
  mitteilungAn?: string | null
  erstelltAm?: Iso
  clientEingabeAm?: Iso
}
