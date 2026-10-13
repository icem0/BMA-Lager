<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useArtikelStore } from '../stores/artikel'
import type { ArtikelStatus } from '../db/types'

const { t } = useI18n()
const router = useRouter()
const artikelStore = useArtikelStore()

interface Form {
  titel: string
  typ: string
  status: ArtikelStatus
  lieferant: string
  verpackungseinheit: number
  mindestbestand: number | null
  bestellnummer: string
  listenpreis: number | null
}

const leeresFormular = (): Form => ({
  titel: '',
  typ: '',
  status: 'verfuegbar',
  lieferant: '',
  verpackungseinheit: 1,
  mindestbestand: null,
  bestellnummer: '',
  listenpreis: null,
})

const formular = ref<Form>(leeresFormular())
const fehler = ref<string>('')

async function speichern(): Promise<void> {
  fehler.value = ''
  if (!formular.value.titel.trim()) {
    fehler.value = t('view.artikel.form.pflicht') + ': ' + t('view.artikel.form.titel')
    return
  }
  if (!formular.value.typ.trim()) {
    fehler.value = t('view.artikel.form.pflicht') + ': ' + t('view.artikel.form.typ')
    return
  }
  await artikelStore.anlegen({
    titel: formular.value.titel.trim(),
    typ: formular.value.typ.trim(),
    status: formular.value.status,
    lieferant: formular.value.lieferant.trim() || null,
    verpackungseinheit: formular.value.verpackungseinheit,
    mindestbestand: formular.value.mindestbestand,
    bestellnummer: formular.value.bestellnummer.trim() || null,
    listenpreis: formular.value.listenpreis,
  })
  void router.push('/artikel')
}

function abbrechen(): void {
  void router.push('/artikel')
}
</script>

<template>
  <section class="view">
    <h1>{{ t('view.artikel.form.h1') }}</h1>

    <form class="form" @submit.prevent="speichern">
      <label>
        <span>{{ t('view.artikel.form.titel') }} *</span>
        <input v-model="formular.titel" required autocomplete="off" />
      </label>
      <label>
        <span>{{ t('view.artikel.form.typ') }} *</span>
        <input v-model="formular.typ" required autocomplete="off" />
      </label>
      <label>
        <span>{{ t('view.artikel.form.status') }}</span>
        <select v-model="formular.status">
          <option value="verfuegbar">{{ t('view.artikel.status.verfuegbar') }}</option>
          <option value="reserviert">{{ t('view.artikel.status.reserviert') }}</option>
          <option value="gesperrt">{{ t('view.artikel.status.gesperrt') }}</option>
          <option value="ausgesondert">{{ t('view.artikel.status.ausgesondert') }}</option>
        </select>
      </label>
      <label>
        <span>{{ t('view.artikel.form.lieferant') }}</span>
        <input v-model="formular.lieferant" autocomplete="off" />
      </label>
      <label>
        <span>{{ t('view.artikel.form.ve') }}</span>
        <input v-model.number="formular.verpackungseinheit" type="number" min="1" />
      </label>
      <label>
        <span>{{ t('view.artikel.form.mindestbestand') }}</span>
        <input v-model.number="formular.mindestbestand" type="number" min="0" />
      </label>
      <label>
        <span>{{ t('view.artikel.form.bestellnummer') }}</span>
        <input v-model="formular.bestellnummer" autocomplete="off" />
      </label>
      <label>
        <span>Listenpreis</span>
        <input v-model.number="formular.listenpreis" type="number" min="0" step="0.01" />
      </label>

      <p v-if="fehler" class="fehler">{{ fehler }}</p>

      <div class="actions">
        <button type="submit">{{ t('view.artikel.form.speichern') }}</button>
        <button type="button" @click="abbrechen">
          {{ t('view.artikel.form.abbrechen') }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.view {
  max-width: 640px;
}
.form {
  display: grid;
  gap: 0.75rem;
}
.form label {
  display: grid;
  gap: 0.25rem;
}
.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.fehler {
  color: #b00020;
}
</style>
