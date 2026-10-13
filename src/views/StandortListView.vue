<script setup lang="ts">
import { ref } from 'vue'
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
</script>

<template>
  <section class="view">
    <header class="view-head">
      <h1>{{ t('view.standort.h1') }}</h1>
      <button type="button" @click="formularOffen = !formularOffen">
        {{ formularOffen ? t('view.common.abbrechen') : t('view.standort.neu') }}
      </button>
    </header>

    <form v-if="formularOffen" class="form" @submit.prevent="anlegen">
      <label>
        <span>{{ t('view.standort.form.name') }}</span>
        <input v-model="formular.name" required autocomplete="off" />
      </label>
      <label>
        <span>{{ t('view.standort.form.typ') }}</span>
        <select v-model="formular.typ">
          <option value="lager">{{ t('view.standort.typen.lager') }}</option>
          <option value="auto">{{ t('view.standort.typen.auto') }}</option>
          <option value="baustelle">{{ t('view.standort.typen.baustelle') }}</option>
          <option value="extern">{{ t('view.standort.typen.extern') }}</option>
        </select>
      </label>
      <label>
        <span>{{ t('view.standort.form.projekt') }}</span>
        <input v-model="formular.projekt" autocomplete="off" />
      </label>
      <label>
        <span>{{ t('view.standort.form.kennzeichen') }}</span>
        <input v-model="formular.kennzeichen" autocomplete="off" />
      </label>
      <label class="check">
        <input v-model="formular.standard" type="checkbox" />
        <span>{{ t('view.standort.form.standard') }}</span>
      </label>
      <div class="actions">
        <button type="submit" :disabled="!formular.name.trim()">
          {{ t('view.standort.form.speichern') }}
        </button>
        <button type="button" @click="((formularOffen = false), reset())">
          {{ t('view.standort.form.abbrechen') }}
        </button>
      </div>
    </form>

    <p v-if="standortStore.aktive.length === 0 && !formularOffen" class="leer">
      {{ t('view.standort.leer') }}
    </p>

    <table v-else class="data">
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
        <tr v-for="s in standortStore.aktive" :key="s.id">
          <td>{{ s.name }}</td>
          <td>{{ t(`view.standort.typen.${s.typ}`) }}</td>
          <td>{{ s.projekt ?? '—' }}</td>
          <td>{{ s.kennzeichen ?? '—' }}</td>
          <td>{{ s.standard ? t('view.common.ja') : t('view.common.nein') }}</td>
          <td class="actions-cell">
            <button v-if="!s.standard" type="button" @click="setStandard(s.id)">
              {{ t('view.standort.spalten.standard') }}
            </button>
            <button type="button" @click="archivieren(s.id)">
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
  max-width: 960px;
}
.view-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}
.form {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  margin-bottom: 1rem;
}
.form label {
  display: grid;
  gap: 0.25rem;
}
.form label.check {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.actions {
  display: flex;
  gap: 0.5rem;
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
  gap: 0.25rem;
  justify-content: flex-end;
}
.leer {
  color: #666;
}
</style>
