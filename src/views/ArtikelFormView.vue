<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useArtikelStore } from '../stores/artikel'
import { useArtikelTypen } from '../composables/useArtikelTypen'
import type { ArtikelStatus } from '../db/types'

const { t } = useI18n()
const router = useRouter()
const artikelStore = useArtikelStore()
const { nurKonfigurierte } = useArtikelTypen()

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

const initialForm: Form = (() => {
  return {
    titel: '',
    typ: nurKonfigurierte.value[0] ?? '',
    status: 'verfuegbar',
    lieferant: '',
    verpackungseinheit: 1,
    mindestbestand: null,
    bestellnummer: '',
    listenpreis: null,
  }
})()

const formular = ref<Form>({ ...initialForm })
const fehler = ref<string>('')
const laufend = ref(false)

async function speichern(): Promise<void> {
  if (laufend.value) return
  fehler.value = ''
  if (!formular.value.titel.trim()) {
    fehler.value = t('view.artikel.form.pflicht') + ': ' + t('view.artikel.form.titel')
    return
  }
  if (!formular.value.typ) {
    fehler.value = t('view.artikel.form.pflicht') + ': ' + t('view.artikel.form.typ')
    return
  }
  laufend.value = true
  try {
    await artikelStore.anlegen({
      titel: formular.value.titel.trim(),
      typ: formular.value.typ,
      status: formular.value.status,
      lieferant: formular.value.lieferant.trim() || null,
      verpackungseinheit: formular.value.verpackungseinheit,
      mindestbestand: formular.value.mindestbestand,
      bestellnummer: formular.value.bestellnummer.trim() || null,
      listenpreis: formular.value.listenpreis,
    })
    void router.push('/artikel')
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : String(e)
  } finally {
    laufend.value = false
  }
}

function abbrechen(): void {
  void router.push('/artikel')
}

const statusOptionen: ArtikelStatus[] = [
  'verfuegbar',
  'reserviert',
  'gesperrt',
  'ausgesondert',
  'archiviert',
]
</script>

<template>
  <section class="view">
    <header class="view-head">
      <h1>{{ t('view.artikel.form.h1') }}</h1>
      <RouterLink to="/artikel" class="btn">{{ t('view.artikel.form.abbrechen') }}</RouterLink>
    </header>

    <div class="card">
      <form class="form" :aria-busy="laufend || undefined" @submit.prevent="speichern">
        <label>
          <span>{{ t('view.artikel.form.titel') }} *</span>
          <input v-model="formular.titel" required autocomplete="off" :disabled="laufend" />
        </label>
        <label>
          <span>{{ t('view.artikel.form.typ') }} *</span>
          <select v-model="formular.typ" required :disabled="laufend">
            <option value="" disabled>— wählen —</option>
            <option v-for="typ in nurKonfigurierte" :key="typ" :value="typ">{{ typ }}</option>
          </select>
          <small class="hint">
            Typen werden unter
            <RouterLink to="/einstellungen/typen">Einstellungen → Typen</RouterLink>
            gepflegt.
          </small>
        </label>
        <label>
          <span>{{ t('view.artikel.form.status') }}</span>
          <select v-model="formular.status" :disabled="laufend">
            <option v-for="s in statusOptionen" :key="s" :value="s">
              {{ t(`view.artikel.status.${s}`) }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ t('view.artikel.form.lieferant') }}</span>
          <input v-model="formular.lieferant" autocomplete="off" :disabled="laufend" />
        </label>
        <div class="row">
          <label>
            <span>{{ t('view.artikel.form.ve') }}</span>
            <input
              v-model.number="formular.verpackungseinheit"
              type="number"
              min="1"
              :disabled="laufend"
            />
          </label>
          <label>
            <span>{{ t('view.artikel.form.mindestbestand') }}</span>
            <input
              v-model.number="formular.mindestbestand"
              type="number"
              min="0"
              :disabled="laufend"
            />
          </label>
        </div>
        <label>
          <span>{{ t('view.artikel.form.bestellnummer') }}</span>
          <input v-model="formular.bestellnummer" autocomplete="off" :disabled="laufend" />
        </label>
        <label>
          <span>Listenpreis</span>
          <input
            v-model.number="formular.listenpreis"
            type="number"
            min="0"
            step="0.01"
            :disabled="laufend"
          />
        </label>

        <p v-if="fehler" class="fehler" role="alert">{{ fehler }}</p>

        <div class="form-actions">
          <button type="submit" class="primary" :disabled="laufend">
            {{ laufend ? '…' : t('view.artikel.form.speichern') }}
          </button>
          <button type="button" :disabled="laufend" @click="abbrechen">
            {{ t('view.artikel.form.abbrechen') }}
          </button>
        </div>
      </form>
    </div>
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
</style>
