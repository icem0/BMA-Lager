// Artikel-Store: lädt die `artikel`-Tabelle reaktiv via Dexie liveQuery.
// Stellt Suche/Filter bereit; Mutationen (anlegen/ändern/archivieren) hier,
// weil Artikel kein Buchungs-Fachobjekt sind und keine Domain-Schicht haben.

import { defineStore } from 'pinia'
import { liveQuery, type Subscription } from 'dexie'
import { computed, ref, onScopeDispose } from 'vue'
import { getDb } from '../db/database'
import type { Artikel, ArtikelStatus, NachbestellHinweis } from '../db/types'
import { neueUuid, jetztIso } from '../domain/ids'

export interface ArtikelEingabe {
  titel: string
  typ: string
  status?: ArtikelStatus
  sharePointId?: number | null
  foto?: string | null
  lieferant?: string | null
  verpackungseinheit?: number
  mindestbestand?: number | null
  nachbestellHinweis?: NachbestellHinweis
  bestellnummer?: string | null
  listenpreis?: number | null
}

export interface ArtikelFilter {
  suche?: string
  typ?: string
  status?: ArtikelStatus | 'alle'
  nurAktive?: boolean
}

export const useArtikelStore = defineStore('artikel', () => {
  const artikel = ref<Artikel[]>([])
  const geladen = ref(false)
  const filter = ref<ArtikelFilter>({ nurAktive: true, status: 'alle' })
  let subscription: Subscription | null = null

  function start() {
    if (subscription) return
    subscription = liveQuery(() => getDb().artikel.toArray()).subscribe({
      next: (rows) => {
        artikel.value = rows
        geladen.value = true
      },
      error: (e) => {
        console.error('artikel liveQuery error:', e)
      },
    })
  }

  function stop() {
    subscription?.unsubscribe()
    subscription = null
  }

  onScopeDispose(stop)

  function byId(id: string): Artikel | undefined {
    return artikel.value.find((a) => a.id === id)
  }

  const gefiltert = computed<Artikel[]>(() => {
    const f = filter.value
    const suche = (f.suche ?? '').trim().toLowerCase()
    return artikel.value.filter((a) => {
      if (f.nurAktive && a.archiviert) return false
      if (f.status && f.status !== 'alle' && a.status !== f.status) return false
      if (f.typ && a.typ !== f.typ) return false
      if (suche) {
        const haystack =
          `${a.titel} ${a.typ} ${a.lieferant ?? ''} ${a.bestellnummer ?? ''}`.toLowerCase()
        if (!haystack.includes(suche)) return false
      }
      return true
    })
  })

  const typen = computed<string[]>(() => {
    const s = new Set<string>()
    for (const a of artikel.value) s.add(a.typ)
    return Array.from(s).sort()
  })

  function setFilter(next: ArtikelFilter): void {
    filter.value = next
  }

  async function anlegen(e: ArtikelEingabe): Promise<Artikel> {
    const now = jetztIso()
    const a: Artikel = {
      id: neueUuid(),
      sharePointId: e.sharePointId ?? null,
      foto: e.foto ?? null,
      titel: e.titel,
      status: e.status ?? 'verfuegbar',
      typ: e.typ,
      lieferant: e.lieferant ?? null,
      verpackungseinheit: e.verpackungseinheit ?? 1,
      mindestbestand: e.mindestbestand ?? null,
      nachbestellHinweis: e.nachbestellHinweis ?? null,
      bestellnummer: e.bestellnummer ?? null,
      listenpreis: e.listenpreis ?? null,
      geaendertAm: now,
      erstelltAm: now,
      archiviert: false,
    }
    await getDb().artikel.add(a)
    return a
  }

  async function aktualisieren(id: string, patch: Partial<Artikel>): Promise<void> {
    await getDb().artikel.update(id, { ...patch, geaendertAm: jetztIso() })
  }

  async function archivieren(id: string): Promise<void> {
    await getDb().artikel.update(id, { archiviert: true, geaendertAm: jetztIso() })
  }

  return {
    artikel,
    gefiltert,
    typen,
    filter,
    geladen,
    start,
    stop,
    byId,
    setFilter,
    anlegen,
    aktualisieren,
    archivieren,
  }
})
