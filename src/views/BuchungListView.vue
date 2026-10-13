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

const zeilen = computed<Buchung[]>(() => {
  const alle = buchungStore.buchungen
  return alle.filter((b) => {
    if (nurAktive.value && b.storno) return false
    if (artikelFilter.value && b.artikelId !== artikelFilter.value) return false
    return true
  })
})

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
      <RouterLink to="/buchung/neu" class="btn">{{ t('view.common.neu') }}</RouterLink>
    </header>

    <form class="filter" @submit.prevent>
      <select v-model="artikelFilter">
        <option value="">— Alle Artikel —</option>
        <option v-for="a in artikelStore.artikel" :key="a.id" :value="a.id">{{ a.titel }}</option>
      </select>
      <label class="check">
        <input v-model="nurAktive" type="checkbox" />
        <span>nur aktive</span>
      </label>
    </form>

    <p v-if="zeilen.length === 0" class="leer">{{ t('view.buchung.leer') }}</p>

    <table v-else class="data">
      <thead>
        <tr>
          <th>{{ t('view.buchung.spalten.zeit') }}</th>
          <th>{{ t('view.buchung.spalten.artikel') }}</th>
          <th>{{ t('view.buchung.spalten.standort') }}</th>
          <th>{{ t('view.buchung.spalten.typ') }}</th>
          <th>{{ t('view.buchung.spalten.menge') }}</th>
          <th>{{ t('view.buchung.spalten.projekt') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in zeilen" :key="b.id" :class="{ storno: b.storno }">
          <td>{{ new Date(b.erstelltAm).toLocaleString() }}</td>
          <td>{{ nameArtikel(b.artikelId) }}</td>
          <td>{{ nameStandort(b.standortId) }}</td>
          <td>{{ formatTyp(b.typ) }}</td>
          <td :class="b.menge > 0 ? 'plus' : b.menge < 0 ? 'minus' : ''">
            {{ b.menge > 0 ? '+' : '' }}{{ b.menge }}
          </td>
          <td>{{ b.projekt ?? '—' }}</td>
          <td class="actions-cell">
            <button v-if="!b.storno && b.typ !== 'storno'" type="button" @click="stornieren(b)">
              stornieren
            </button>
            <RouterLink v-if="b.typ === 'kommission'" :to="`/kommission/${b.id}`">…</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.view {
  max-width: 1100px;
}
.view-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}
.btn {
  background: #0b3d91;
  color: white;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  text-decoration: none;
}
.filter {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.filter .check {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}
.data {
  width: 100%;
  border-collapse: collapse;
}
.data th,
.data td {
  padding: 0.4rem;
  border-bottom: 1px solid #eee;
  text-align: left;
}
.plus {
  color: #0a7a3a;
}
.minus {
  color: #b00020;
}
.storno {
  color: #999;
  text-decoration: line-through;
}
.actions-cell {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
.leer {
  color: #666;
}
</style>
