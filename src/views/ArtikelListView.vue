<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useArtikelStore } from '../stores/artikel'
import { useStandortStore } from '../stores/standort'
import { useBuchungStore } from '../stores/buchung'

const { t } = useI18n()
const artikelStore = useArtikelStore()
const standortStore = useStandortStore()
const buchungStore = useBuchungStore()

// Form-Felder für Suche + Filter
const suche = ref('')
const filterTyp = ref('')
const filterStatus = ref<'alle' | 'verfuegbar' | 'reserviert' | 'gesperrt' | 'ausgesondert'>('alle')
const nurAktive = ref(true)

function applyFilter(): void {
  artikelStore.setFilter({
    suche: suche.value,
    typ: filterTyp.value || undefined,
    status: filterStatus.value,
    nurAktive: nurAktive.value,
  })
}

const zeilen = computed(() => artikelStore.gefiltert)

function bestandFuerStandard(artikelId: string, standortId: string): number {
  return buchungStore.getBestand(artikelId, standortId)
}

const standardStandort = computed(() => standortStore.standardlager)

async function archivieren(id: string): Promise<void> {
  if (!confirm('Archivieren?')) return
  await artikelStore.archivieren(id)
}
</script>

<template>
  <section class="view">
    <header class="view-head">
      <h1>{{ t('view.artikel.h1') }}</h1>
      <RouterLink to="/artikel/neu" class="btn">{{ t('view.artikel.neu') }}</RouterLink>
    </header>

    <form class="filter" @submit.prevent="applyFilter">
      <input
        v-model="suche"
        type="search"
        :placeholder="t('view.artikel.suche')"
        @input="applyFilter"
      />
      <select v-model="filterTyp" @change="applyFilter">
        <option value="">{{ t('view.artikel.filter.typ') }} —</option>
        <option v-for="typ in artikelStore.typen" :key="typ" :value="typ">{{ typ }}</option>
      </select>
      <select v-model="filterStatus" @change="applyFilter">
        <option value="alle">{{ t('view.artikel.filter.statusAlle') }}</option>
        <option value="verfuegbar">{{ t('view.artikel.status.verfuegbar') }}</option>
        <option value="reserviert">{{ t('view.artikel.status.reserviert') }}</option>
        <option value="gesperrt">{{ t('view.artikel.status.gesperrt') }}</option>
        <option value="ausgesondert">{{ t('view.artikel.status.ausgesondert') }}</option>
      </select>
      <label class="check">
        <input v-model="nurAktive" type="checkbox" @change="applyFilter" />
        <span>{{ t('view.artikel.filter.nurAktive') }}</span>
      </label>
    </form>

    <p v-if="zeilen.length === 0" class="leer">{{ t('view.artikel.leer') }}</p>

    <table v-else class="data">
      <thead>
        <tr>
          <th>{{ t('view.artikel.spalten.titel') }}</th>
          <th>{{ t('view.artikel.spalten.typ') }}</th>
          <th>{{ t('view.artikel.spalten.status') }}</th>
          <th v-if="standardStandort">
            {{ t('view.artikel.spalten.bestand') }} ({{ standardStandort.name }})
          </th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in zeilen" :key="a.id">
          <td>
            <RouterLink :to="`/artikel/${a.id}`">{{ a.titel }}</RouterLink>
          </td>
          <td>{{ a.typ }}</td>
          <td>
            <span v-if="a.archiviert">[{{ t('view.artikel.detail.archiviert') }}]</span>
            <span v-else>{{ t(`view.artikel.status.${a.status}`) }}</span>
          </td>
          <td v-if="standardStandort">
            {{ bestandFuerStandard(a.id, standardStandort.id) }}
          </td>
          <td class="actions-cell">
            <RouterLink :to="`/buchung/neu?artikelId=${a.id}`">
              {{ t('view.artikel.detail.buchen') }}
            </RouterLink>
            <button v-if="!a.archiviert" type="button" @click="archivieren(a.id)">
              {{ t('view.artikel.detail.archivieren') }}
            </button>
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
.filter input[type='search'] {
  flex: 1;
  min-width: 14rem;
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
  padding: 0.5rem;
  border-bottom: 1px solid #eee;
  text-align: left;
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
