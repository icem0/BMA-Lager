// Settings-Store: liest die `einstellungen`-Tabelle reaktiv via Dexie liveQuery.
// Speichert sprache, standardStandortId, aktuellerBenutzer, artikelTypen.

import { defineStore } from 'pinia'
import { liveQuery, type Subscription } from 'dexie'
import { ref, onScopeDispose } from 'vue'
import { getDb } from '../db/database'
import type { Einstellung } from '../db/types'

export type Sprache = 'de' | 'en'

export interface Settings {
  sprache: Sprache
  standardStandortId: string | null
  aktuellerBenutzer: string
  /** Konfigurierbare Liste der Artikel-Typen (Reihenfolge wie angelegt). */
  artikelTypen: string[]
}

const DEFAULTS: Settings = {
  sprache: 'de',
  standardStandortId: null,
  aktuellerBenutzer: '',
  artikelTypen: [
    'Koppler',
    'Alarmierung',
    'FW Peripherie',
    'Zubehör',
    'Sondermelder',
    'Modul',
    'Netzteil',
    'Verbrauchsmaterial',
  ],
}

function toMap(rows: Einstellung[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of rows) m.set(r.key, r.value)
  return m
}

function fromMap(m: Map<string, string>): Settings {
  // artikelTypen wird als JSON-Array serialisiert; Fehlertoleranz bei Altbestand.
  let typen: string[] = DEFAULTS.artikelTypen
  const raw = m.get('artikelTypen')
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((x): x is string => typeof x === 'string')) {
        typen = parsed
      }
    } catch {
      // bewusst ignorieren → Defaults
    }
  }
  return {
    sprache: (m.get('sprache') as Sprache | undefined) ?? DEFAULTS.sprache,
    standardStandortId: m.get('standardStandortId') ?? DEFAULTS.standardStandortId,
    aktuellerBenutzer: m.get('aktuellerBenutzer') ?? DEFAULTS.aktuellerBenutzer,
    artikelTypen: typen,
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULTS, artikelTypen: [...DEFAULTS.artikelTypen] })
  const geladen = ref(false)
  let subscription: Subscription | null = null

  function start() {
    if (subscription) return
    const observable = liveQuery(() => getDb().einstellungen.toArray())
    subscription = observable.subscribe({
      next: (rows) => {
        settings.value = fromMap(toMap(rows))
        geladen.value = true
      },
      error: (e) => {
        console.error('settings liveQuery error:', e)
      },
    })
  }

  function stop() {
    subscription?.unsubscribe()
    subscription = null
  }

  onScopeDispose(stop)

  async function setKey(key: string, value: string): Promise<void> {
    await getDb().einstellungen.put({ key, value })
  }

  async function setSprache(sprache: Sprache): Promise<void> {
    await setKey('sprache', sprache)
  }

  async function setStandardStandort(id: string | null): Promise<void> {
    await setKey('standardStandortId', id ?? '')
  }

  async function setBenutzer(name: string): Promise<void> {
    await setKey('aktuellerBenutzer', name)
  }

  async function setArtikelTypen(typen: string[]): Promise<void> {
    await setKey('artikelTypen', JSON.stringify(typen))
  }

  return {
    settings,
    geladen,
    start,
    stop,
    setSprache,
    setStandardStandort,
    setBenutzer,
    setArtikelTypen,
  }
})
