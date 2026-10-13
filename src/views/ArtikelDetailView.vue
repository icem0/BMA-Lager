<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useArtikelStore } from '../stores/artikel'
import { useStandortStore } from '../stores/standort'
import { useBuchungStore } from '../stores/buchung'
import type { Artikel } from '../db/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const artikelStore = useArtikelStore()
const standortStore = useStandortStore()
const buchungStore = useBuchungStore()

const artikelId = computed<string>(() => String(route.params.id ?? ''))
const artikel = computed<Artikel | undefined>(() => artikelStore.byId(artikelId.value))

const bestaende = computed<Array<{ name: string; menge: number; standortId: string }>>(() => {
  if (!artikel.value) return []
  const map = buchungStore.getBestandProStandort(artikel.value.id)
  return standortStore.aktive
    .map((s) => ({ standortId: s.id, name: s.name, menge: map.get(s.id) ?? 0 }))
    .filter((x) => x.menge !== 0)
})

const historie = computed(() => {
  if (!artikel.value) return []
  return buchungStore.byArtikel(artikel.value.id).slice().reverse()
})

async function archivieren(): Promise<void> {
  if (!artikel.value) return
  if (!confirm('Archivieren?')) return
  await artikelStore.archivieren(artikel.value.id)
  void router.push('/artikel')
}
</script>

<template>
  <section v-if="artikel" class="view">
    <header class="view-head">
      <h1>
        {{ artikel.titel }}
        <span v-if="artikel.archiviert" class="muted">
          [{{ t('view.artikel.detail.archiviert') }}]
        </span>
      </h1>
      <RouterLink :to="`/buchung/neu?artikelId=${artikel.id}`" class="btn">
        {{ t('view.artikel.detail.buchen') }}
      </RouterLink>
    </header>

    <dl class="meta">
      <div>
        <dt>{{ t('view.artikel.spalten.typ') }}</dt>
        <dd>{{ artikel.typ }}</dd>
      </div>
      <div>
        <dt>{{ t('view.artikel.spalten.status') }}</dt>
        <dd>{{ t(`view.artikel.status.${artikel.status}`) }}</dd>
      </div>
      <div v-if="artikel.lieferant">
        <dt>{{ t('view.artikel.form.lieferant') }}</dt>
        <dd>{{ artikel.lieferant }}</dd>
      </div>
      <div v-if="artikel.bestellnummer">
        <dt>{{ t('view.artikel.form.bestellnummer') }}</dt>
        <dd>{{ artikel.bestellnummer }}</dd>
      </div>
    </dl>

    <h2>{{ t('view.artikel.detail.bestandProStandort') }}</h2>
    <ul class="bestaende">
      <li v-for="b in bestaende" :key="b.standortId">
        <strong>{{ b.menge }}</strong> {{ b.name }}
      </li>
      <li v-if="bestaende.length === 0" class="muted">—</li>
    </ul>

    <h2>{{ t('view.artikel.detail.historie') }}</h2>
    <p v-if="historie.length === 0" class="muted">{{ t('view.buchung.leer') }}</p>
    <table v-else class="data">
      <thead>
        <tr>
          <th>{{ t('view.buchung.spalten.zeit') }}</th>
          <th>{{ t('view.buchung.spalten.typ') }}</th>
          <th>{{ t('view.buchung.spalten.menge') }}</th>
          <th>{{ t('view.buchung.spalten.standort') }}</th>
          <th>{{ t('view.buchung.spalten.projekt') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="b in historie" :key="b.id">
          <td>{{ new Date(b.erstelltAm).toLocaleString() }}</td>
          <td>{{ b.typ }}</td>
          <td>{{ b.menge }}</td>
          <td>{{ standortStore.byId(b.standortId)?.name ?? '—' }}</td>
          <td>{{ b.projekt ?? '—' }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="!artikel.archiviert" class="actions">
      <button type="button" @click="archivieren">
        {{ t('view.artikel.detail.archivieren') }}
      </button>
    </div>
  </section>
  <section v-else class="view">
    <p>Lade…</p>
  </section>
</template>

<style scoped>
.view {
  max-width: 960px;
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
.meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.5rem 1rem;
  margin: 0 0 1rem;
}
.meta div {
  display: flex;
  flex-direction: column;
}
.meta dt {
  font-weight: 600;
  font-size: 0.85rem;
  color: #555;
}
.bestaende {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.bestaende li {
  background: #f6f7fb;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
}
.data {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.5rem;
}
.data th,
.data td {
  padding: 0.4rem;
  border-bottom: 1px solid #eee;
  text-align: left;
}
.muted {
  color: #888;
}
.actions {
  margin-top: 1rem;
}
</style>
