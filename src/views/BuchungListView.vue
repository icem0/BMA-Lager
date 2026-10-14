<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useBuchungStore } from '../stores/buchung'
import { useArtikelStore } from '../stores/artikel'
import { useStandortStore } from '../stores/standort'
import type { Buchung } from '../db/types'

const { t } = useI18n()
const buchungStore = useBuchungStore()
const artikelStore = useArtikelStore()
const standortStore = useStandortStore()

const nurAktive = ref(true)
const artikelFilter = ref<string>('')

const zeilen = computed<Buchung[]>(() =>
  buchungStore.buchungen.filter((b) => {
    if (nurAktive.value && b.storno) return false
    if (artikelFilter.value && b.artikelId !== artikelFilter.value) return false
    return true
  }),
)

function nameArtikel(id: string): string {
  return artikelStore.byId(id)?.titel ?? '—'
}
function nameStandort(id: string): string {
  return standortStore.byId(id)?.name ?? '—'
}

function formatTyp(typ: Buchung['typ']): string {
  if (typ === 'einlagerung' || typ === 'entnahme' || typ === 'umlagerung' || typ === 'inventur') {
    return t(`view.buchung.form.typen.${typ}`)
  }
  return typ
}

function formatDatum(iso: string): string {
  return new Date(iso).toLocaleString()
}

async function stornieren(b: Buchung): Promise<void> {
  if (b.storno) return
  if (!confirm('Stornieren?')) return
  await buchungStore.mu.stornieren({
    buchungId: b.id,
    grund: 'Storno aus Buchungsliste',
    erstelltVon: '',
  })
}
</script>

<template>
  <section class="view">
    <header class="view-head">
      <h1>{{ t('view.buchung.h1') }}</h1>
      <RouterLink to="/buchung/neu" class="btn primary">{{ t('view.common.neu') }}</RouterLink>
    </header>

    <div class="filter-bar">
      <select v-model="artikelFilter">
        <option value="">— Alle Artikel —</option>
        <option v-for="a in artikelStore.artikel" :key="a.id" :value="a.id">{{ a.titel }}</option>
      </select>
      <label class="check">
        <input v-model="nurAktive" type="checkbox" />
        <span>nur aktive</span>
      </label>
    </div>

    <p v-if="zeilen.length === 0" class="empty-state">{{ t('view.buchung.leer') }}</p>

    <table v-else class="data">
      <thead>
        <tr>
          <th>{{ t('view.buchung.spalten.zeit') }}</th>
          <th>{{ t('view.buchung.spalten.artikel') }}</th>
          <th>{{ t('view.buchung.spalten.standort') }}</th>
          <th>{{ t('view.buchung.spalten.typ') }}</th>
          <th class="num">{{ t('view.buchung.spalten.menge') }}</th>
          <th>{{ t('view.buchung.spalten.projekt') }}</th>
          <th>{{ t('view.buchung.spalten.von') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in zeilen" :key="b.id" :class="{ storno: b.storno }">
          <td>{{ formatDatum(b.erstelltAm) }}</td>
          <td>{{ nameArtikel(b.artikelId) }}</td>
          <td>{{ nameStandort(b.standortId) }}</td>
          <td>
            <span class="badge">{{ formatTyp(b.typ) }}</span>
          </td>
          <td :class="b.menge > 0 ? 'num-plus' : b.menge < 0 ? 'num-minus' : 'num'">
            {{ b.menge > 0 ? '+' : '' }}{{ b.menge }}
          </td>
          <td>{{ b.projekt ?? '—' }}</td>
          <td>{{ b.erstelltVon }}</td>
          <td class="actions-cell">
            <button
              v-if="!b.storno && b.typ !== 'storno' && b.typ !== 'kommission'"
              type="button"
              class="danger"
              @click="stornieren(b)"
            >
              Storno
            </button>
            <RouterLink v-if="b.typ === 'kommission'" :to="`/kommission/${b.id}`" class="btn">
              …
            </RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.data .num {
  font-variant-numeric: tabular-nums;
  text-align: right;
  font-weight: 600;
}
</style>
