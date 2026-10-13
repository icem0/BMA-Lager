// Settings-Store: liest die `einstellungen`-Tabelle reaktiv via Dexie liveQuery.
// Speichert sprache, standardStandortId, aktuellerBenutzer (frei wählbarer Anzeigename, keine Auth).

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
}

const DEFAULTS: Settings = {
  sprache: 'de',
  standardStandortId: null,
  aktuellerBenutzer: '',
}

function toMap(rows: Einstellung[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of rows) m.set(r.key, r.value)
  return m
}

function fromMap(m: Map<string, string>): Settings {
  return {
    sprache: (m.get('sprache') as Sprache | undefined) ?? DEFAULTS.sprache,
    standardStandortId: m.get('standardStandortId') ?? DEFAULTS.standardStandortId,
    aktuellerBenutzer: m.get('aktuellerBenutzer') ?? DEFAULTS.aktuellerBenutzer,
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULTS })
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

  return { settings, geladen, start, stop, setSprache, setStandardStandort, setBenutzer }
})
