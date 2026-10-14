<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useArtikelStore } from '../stores/artikel'
import { useStandortStore } from '../stores/standort'
import { useBuchungStore } from '../stores/buchung'
import { useArtikelTypen } from '../composables/useArtikelTypen'
import type { ArtikelStatus } from '../db/types'

const { t } = useI18n()
const artikelStore = useArtikelStore()
const standortStore = useStandortStore()
const buchungStore = useBuchungStore()
const { alleBenutzten } = useArtikelTypen()

const suche = ref('')
const filterTyp = ref('')
const filterStatus = ref<'alle' | ArtikelStatus>('alle')
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

function bestandStandard(artikelId: string, standortId: string): number {
  return buchungStore.getBestand(artikelId, standortId)
}

const standardStandort = computed(() => standortStore.standardlager)

async function archivieren(id: string): Promise<void> {
  if (!confirm('Archivieren?')) return
  await artikelStore.archivieren(id)
}

const statusOptionen: { value: 'alle' | ArtikelStatus; labelKey: string }[] = [
  { value: 'alle', labelKey: 'view.artikel.filter.statusAlle' },
  { value: 'verfuegbar', labelKey: 'view.artikel.status.verfuegbar' },
  { value: 'reserviert', labelKey: 'view.artikel.status.reserviert' },
  { value: 'gesperrt', labelKey: 'view.artikel.status.gesperrt' },
  { value: 'ausgesondert', labelKey: 'view.artikel.status.ausgesondert' },
]
</script>

<template>
  <section class="view">
    <header class="view-head">
      <h1>{{ t('view.artikel.h1') }}</h1>
      <RouterLink to="/artikel/neu" class="btn primary">{{ t('view.artikel.neu') }}</RouterLink>
    </header>

    <div class="filter-bar">
      <input
        v-model="suche"
        type="search"
        :placeholder="t('view.artikel.suche')"
        @input="applyFilter"
      />
      <select v-model="filterTyp" @change="applyFilter">
        <option value="">{{ t('view.artikel.filter.typ') }} —</option>
        <option v-for="typ in alleBenutzten" :key="typ" :value="typ">{{ typ }}</option>
      </select>
      <select v-model="filterStatus" @change="applyFilter">
        <option v-for="opt in statusOptionen" :key="opt.value" :value="opt.value">
          {{ t(opt.labelKey) }}
        </option>
      </select>
      <label class="check">
        <input v-model="nurAktive" type="checkbox" @change="applyFilter" />
        <span>{{ t('view.artikel.filter.nurAktive') }}</span>
      </label>
    </div>

    <p v-if="zeilen.length === 0" class="empty-state">{{ t('view.artikel.leer') }}</p>

    <table v-else class="data">
      <thead>
        <tr>
          <th>{{ t('view.artikel.spalten.titel') }}</th>
          <th>{{ t('view.artikel.spalten.typ') }}</th>
          <th>{{ t('view.artikel.spalten.status') }}</th>
          <th v-if="standardStandort" class="num">
            {{ t('view.artikel.spalten.bestand') }} ({{ standardStandort.name }})
          </th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in zeilen" :key="a.id">
          <td>
            <RouterLink :to="`/artikel/${a.id}`" class="link">{{ a.titel }}</RouterLink>
          </td>
          <td>{{ a.typ }}</td>
          <td>
            <span v-if="a.archiviert" class="badge">
              {{ t('view.artikel.detail.archiviert') }}
            </span>
            <span v-else class="badge">{{ t(`view.artikel.status.${a.status}`) }}</span>
          </td>
          <td v-if="standardStandort" class="num">
            {{ bestandStandard(a.id, standardStandort.id) }}
          </td>
          <td class="actions-cell">
            <RouterLink :to="`/buchung/neu?artikelId=${a.id}`" class="btn">
              {{ t('view.artikel.detail.buchen') }}
            </RouterLink>
            <button v-if="!a.archiviert" type="button" class="danger" @click="archivieren(a.id)">
              {{ t('view.artikel.detail.archivieren') }}
            </button>
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

.link {
  color: var(--text-strong);
  font-weight: 500;
}
.link:hover {
  color: var(--accent);
  text-decoration: none;
}

.actions-cell {
  flex-wrap: wrap;
  gap: 0.3rem;
}
</style>
