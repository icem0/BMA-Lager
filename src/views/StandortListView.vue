<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStandortStore } from '../stores/standort'
import type { StandortTyp } from '../db/types'

const { t } = useI18n()
const standortStore = useStandortStore()

interface Form {
  name: string
  typ: StandortTyp
  projekt: string
  kennzeichen: string
  standard: boolean
}

const leeresFormular = (): Form => ({
  name: '',
  typ: 'lager',
  projekt: '',
  kennzeichen: '',
  standard: false,
})

const formularOffen = ref(false)
const formular = ref<Form>(leeresFormular())
const archivierteAnzeigen = ref(false)

function reset(): void {
  formular.value = leeresFormular()
}

async function anlegen(): Promise<void> {
  if (!formular.value.name.trim()) return
  await standortStore.anlegen({
    name: formular.value.name.trim(),
    typ: formular.value.typ,
    projekt: formular.value.projekt.trim() || null,
    kennzeichen: formular.value.kennzeichen.trim() || null,
    standard: formular.value.standard,
  })
  formularOffen.value = false
  reset()
}

async function setStandard(id: string): Promise<void> {
  await standortStore.setStandard(id)
}

async function archivieren(id: string): Promise<void> {
  if (!confirm('Archivieren?')) return
  await standortStore.archivieren(id)
}

async function wiederherstellen(id: string): Promise<void> {
  await standortStore.wiederherstellen(id)
}

const typOptionen: StandortTyp[] = ['lager', 'auto', 'baustelle', 'extern']
const sichtbareStandorte = computed(() =>
  archivierteAnzeigen.value
    ? [...standortStore.aktive, ...standortStore.archivierte]
    : standortStore.aktive,
)
const istLeer = computed(() => sichtbareStandorte.value.length === 0 && !formularOffen.value)
</script>

<template>
  <section class="view">
    <header class="view-head">
      <h1>{{ t('view.standort.h1') }}</h1>
      <button type="button" class="primary" @click="formularOffen = !formularOffen">
        {{ formularOffen ? t('view.common.abbrechen') : t('view.standort.neu') }}
      </button>
    </header>

    <div v-if="formularOffen" class="card">
      <form class="form" @submit.prevent="anlegen">
        <label>
          <span>{{ t('view.standort.form.name') }}</span>
          <input v-model="formular.name" required autocomplete="off" />
        </label>
        <label>
          <span>{{ t('view.standort.form.typ') }}</span>
          <select v-model="formular.typ">
            <option v-for="opt in typOptionen" :key="opt" :value="opt">
              {{ t(`view.standort.typen.${opt}`) }}
            </option>
          </select>
        </label>
        <div class="row">
          <label>
            <span>{{ t('view.standort.form.projekt') }}</span>
            <input v-model="formular.projekt" autocomplete="off" />
          </label>
          <label>
            <span>{{ t('view.standort.form.kennzeichen') }}</span>
            <input v-model="formular.kennzeichen" autocomplete="off" />
          </label>
        </div>
        <label class="check">
          <input v-model="formular.standard" type="checkbox" />
          <span>{{ t('view.standort.form.standard') }}</span>
        </label>

        <div class="form-actions">
          <button type="submit" class="primary" :disabled="!formular.name.trim()">
            {{ t('view.standort.form.speichern') }}
          </button>
          <button type="button" @click="((formularOffen = false), reset())">
            {{ t('view.standort.form.abbrechen') }}
          </button>
        </div>
      </form>
    </div>

    <p v-if="istLeer" class="empty-state">
      {{ t('view.standort.leer') }}
    </p>

    <div v-else class="filter-bar">
      <label class="check">
        <input v-model="archivierteAnzeigen" type="checkbox" />
        <span>{{ t('view.standort.filter.archivierteAnzeigen') }}</span>
      </label>
    </div>

    <table v-if="!istLeer" class="data">
      <thead>
        <tr>
          <th>{{ t('view.standort.spalten.name') }}</th>
          <th>{{ t('view.standort.spalten.typ') }}</th>
          <th>{{ t('view.standort.spalten.projekt') }}</th>
          <th>{{ t('view.standort.spalten.kennzeichen') }}</th>
          <th>{{ t('view.standort.spalten.standard') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in sichtbareStandorte" :key="s.id" :class="{ archived: s.archiviert }">
          <td>{{ s.name }}</td>
          <td>
            <span class="badge">{{ t(`view.standort.typen.${s.typ}`) }}</span>
          </td>
          <td>{{ s.projekt ?? '—' }}</td>
          <td>{{ s.kennzeichen ?? '—' }}</td>
          <td>
            <span v-if="s.standard" class="badge accent">{{ t('view.common.ja') }}</span>
            <span v-else class="muted">{{ t('view.common.nein') }}</span>
          </td>
          <td class="actions-cell">
            <button v-if="!s.archiviert && !s.standard" type="button" @click="setStandard(s.id)">
              {{ t('view.standort.spalten.standard') }}
            </button>
            <button v-if="!s.archiviert" type="button" class="danger" @click="archivieren(s.id)">
              {{ t('view.artikel.detail.archivieren') }}
            </button>
            <button v-else type="button" @click="wiederherstellen(s.id)">
              {{ t('view.standort.wiederherstellen') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
}
@media (max-width: 540px) {
  .row {
    grid-template-columns: 1fr;
  }
}

.data tr.archived td {
  color: var(--text-muted, #888);
  text-decoration: line-through;
}
</style>
