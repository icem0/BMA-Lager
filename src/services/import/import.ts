// CSV-Import-Orchestrator.
// Nimmt zwei Parse-Ergebnisse (Lager + Warenfluss) plus Mappings und schreibt
// sie atomar in eine Dexie-Transaktion. Bei Fehler vollständiger Rollback.

import { getDb } from '../../db/database'
import type { Artikel, Buchung } from '../../db/types'
import { neueUuid, jetztIso } from '../../domain/ids'
import type { ArtikelMapping, WarenMapping } from './mapping'
import {
  normalizeArtikelStatus,
  normalizeNachbestellHinweis,
  normalizeWarenTyp,
  parseFloatOrNull,
  parseInt0,
  parseIsoDatum,
  parseMenge,
} from './mapping'

export interface ImportBericht {
  artikelAngelegt: number
  buchungenAngelegt: number
  konflikte: string[]
  /** Wenn gesetzt, ist der Import abgebrochen worden. */
  fehler?: string
}

interface ArtikelCacheEintrag {
  id: string
  sharePointId: number | null
  titelLower: string
}

export interface ImportEingabe {
  artikelRows: string[][]
  artikelHeaders: string[]
  artikelMapping: ArtikelMapping
  warenRows: string[][]
  warenHeaders: string[]
  warenMapping: WarenMapping
  /** Name des Haupt-Standorts (Lager), an den Waren ohne Standort-Zuordnung gebucht werden. */
  hauptLagerName: string
}

/**
 * Importiert in einer Dexie-Transaktion.
 * Wirft bei Validierungs-/Konfliktfehlern – dann ist die DB unverändert.
 */
export async function importAusCsv(e: ImportEingabe): Promise<ImportBericht> {
  const db = getDb()
  const bericht: ImportBericht = {
    artikelAngelegt: 0,
    buchungenAngelegt: 0,
    konflikte: [],
  }

  await db.transaction('rw', [db.artikel, db.standorte, db.buchungen, db.auditLog], async () => {
    // 1. Hauptlager sicherstellen.
    let lagerRecord = (await db.standorte.filter((s) => s.name === e.hauptLagerName).toArray())[0]
    if (!lagerRecord) {
      lagerRecord = {
        id: neueUuid(),
        name: e.hauptLagerName,
        typ: 'lager',
        projekt: null,
        kennzeichen: null,
        standard: true,
        archiviert: false,
      }
      await db.standorte.add(lagerRecord)
    } else if (!lagerRecord.standard) {
      await db.standorte.update(lagerRecord.id, { standard: true })
    }

    // 2. Artikel anlegen.
    const artikelByTitle = new Map<string, ArtikelCacheEintrag>()

    for (let i = 0; i < e.artikelRows.length; i++) {
      const row = e.artikelRows[i]
      if (!row) continue
      const a: Artikel = mappeArtikelZeile(row, e.artikelHeaders, e.artikelMapping)
      // Deduplizierung über sharePointId ODER Titel (innerhalb derer CSV).
      const existierend =
        a.sharePointId != null
          ? await db.artikel.where('sharePointId').equals(a.sharePointId).first()
          : await db.artikel.where('titel').equals(a.titel).first()
      if (existierend) {
        bericht.konflikte.push(`Artikel "${a.titel}" existiert bereits (Zeile ${i + 2}).`)
        continue
      }
      await db.artikel.add(a)
      bericht.artikelAngelegt += 1
      const eintrag: ArtikelCacheEintrag = {
        id: a.id,
        sharePointId: a.sharePointId,
        titelLower: a.titel.toLowerCase(),
      }
      artikelByTitle.set(eintrag.titelLower, eintrag)
    }

    // Auch: bereits in DB vorhandene Artikel (über sharePointId) für Warenfluss-Lookup.
    const vorhandene = await db.artikel.toArray()
    for (const a of vorhandene) {
      const eintrag: ArtikelCacheEintrag = {
        id: a.id,
        sharePointId: a.sharePointId,
        titelLower: a.titel.toLowerCase(),
      }
      if (!artikelByTitle.has(eintrag.titelLower)) {
        artikelByTitle.set(eintrag.titelLower, eintrag)
      }
    }

    // 3. Waren-Buchungen anlegen.
    for (let i = 0; i < e.warenRows.length; i++) {
      const row = e.warenRows[i]
      if (!row) continue
      const b = mappeWarenZeile(row, e.warenHeaders, e.warenMapping, artikelByTitle, lagerRecord.id)
      if (!b) continue
      await db.buchungen.add(b)
      bericht.buchungenAngelegt += 1
    }

    await db.auditLog.add({
      id: neueUuid(),
      aktion: 'csv-import',
      entitaet: 'artikel',
      entitaetId: 'batch',
      daten: JSON.stringify({
        artikelAngelegt: bericht.artikelAngelegt,
        buchungenAngelegt: bericht.buchungenAngelegt,
        konflikte: bericht.konflikte.length,
      }),
      zeit: jetztIso(),
    })
  })

  return bericht
}

function mappeArtikelZeile(row: string[], headers: string[], mapping: ArtikelMapping): Artikel {
  const now = jetztIso()
  const feld = (name: string): string => {
    const h = headers.find((x) => mapping[x] === name)
    if (!h) return ''
    return row[headers.indexOf(h)] ?? ''
  }
  return {
    id: neueUuid(),
    sharePointId: parseInt0(feld('sharePointId')) || null,
    foto: feld('foto') || null,
    titel: feld('titel'),
    status: normalizeArtikelStatus(feld('status')),
    typ: feld('typ'),
    lieferant: feld('lieferant') || null,
    verpackungseinheit: parseInt0(feld('verpackungseinheit')) || 1,
    mindestbestand: parseFloatOrNull(feld('mindestbestand')),
    nachbestellHinweis: normalizeNachbestellHinweis(feld('nachbestellHinweis')),
    bestellnummer: feld('bestellnummer') || null,
    listenpreis: parseFloatOrNull(feld('listenpreis')),
    geaendertAm: parseIsoDatum(feld('geaendertAm')),
    erstelltAm: now,
    archiviert: false,
  }
}

function mappeWarenZeile(
  row: string[],
  headers: string[],
  mapping: WarenMapping,
  artikelByTitle: Map<string, ArtikelCacheEintrag>,
  fallbackStandortId: string,
): Buchung | null {
  const feld = (name: string): string => {
    const h = headers.find((x) => mapping[x] === name)
    if (!h) return ''
    return row[headers.indexOf(h)] ?? ''
  }

  const titelRaw = feld('artikelTitle').trim()
  if (!titelRaw) return null
  const titelLower = titelRaw.toLowerCase()
  const eintrag = artikelByTitle.get(titelLower)
  if (!eintrag) return null

  const typ = normalizeWarenTyp(feld('typ'))
  const mengeRaw = parseMenge(feld('menge'))
  if (!Number.isFinite(mengeRaw) || mengeRaw === 0) return null
  // erlaube negative (z. B. Entnahmen als negative Werte), sonst mit Vorzeichen rechnen.
  const mengeVorzeichen = typ === 'entnahme' ? -Math.abs(mengeRaw) : Math.abs(mengeRaw)

  return {
    id: neueUuid(),
    artikelId: eintrag.id,
    standortId: fallbackStandortId,
    standortZielId: null,
    typ,
    menge: mengeVorzeichen,
    paarId: null,
    projekt: feld('projekt') || null,
    erstelltAm: parseIsoDatum(feld('erstelltAm')) ?? jetztIso(),
    clientEingabeAm: jetztIso(),
    erstelltVon: feld('erstelltVon') || 'csv-import',
    kommentar: feld('kommentar') || null,
    mitteilungAn: feld('mitteilungAn') || null,
    stornoVon: null,
    storno: false,
    storniertDurch: null,
  }
}
