// Projekt-Store: lädt die `projekte`-Tabelle reaktiv via Dexie liveQuery.

import { defineStore } from 'pinia'
import { liveQuery, type Subscription } from 'dexie'
import { ref, onScopeDispose } from 'vue'
import { getDb } from '../db/database'
import type { Projekt } from '../db/types'
import { neueUuid } from '../domain/ids'

export interface ProjektEingabe {
  nummer: string
  name?: string | null
}

export const useProjektStore = defineStore('projekt', () => {
  const projekte = ref<Projekt[]>([])
  const geladen = ref(false)
  let subscription: Subscription | null = null

  function start() {
    if (subscription) return
    subscription = liveQuery(() =>
      getDb()
        .projekte.filter((p) => !p.archiviert)
        .toArray(),
    ).subscribe({
      next: (rows) => {
        projekte.value = rows
        geladen.value = true
      },
      error: (e) => {
        console.error('projekt liveQuery error:', e)
      },
    })
  }

  function stop() {
    subscription?.unsubscribe()
    subscription = null
  }

  onScopeDispose(stop)

  function byNummer(nummer: string): Projekt | undefined {
    return projekte.value.find((p) => p.nummer === nummer)
  }

  async function anlegen(e: ProjektEingabe): Promise<Projekt> {
    const p: Projekt = {
      id: neueUuid(),
      nummer: e.nummer,
      name: e.name ?? null,
      archiviert: false,
    }
    await getDb().projekte.add(p)
    return p
  }

  async function archivieren(id: string): Promise<void> {
    await getDb().projekte.update(id, { archiviert: true })
  }

  return { projekte, geladen, start, stop, byNummer, anlegen, archivieren }
})
