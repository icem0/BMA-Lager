<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useArtikelStore } from '../stores/artikel'
import { useStandortStore } from '../stores/standort'
import { useBuchungStore } from '../stores/buchung'
import { useSettingsStore } from '../stores/settings'
import type { BuchungsTyp } from '../db/types'
import { NegativerBestandWarnung, PflichtfeldFehltError } from '../domain/errors'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const artikelStore = useArtikelStore()
const standortStore = useStandortStore()
const buchungStore = useBuchungStore()
const settings = useSettingsStore()

const typen: BuchungsTyp[] = ['einlagerung', 'entnahme', 'umlagerung', 'inventur']

const typ = ref<BuchungsTyp>('einlagerung')
const artikelId = ref<string>(String(route.query.artikelId ?? ''))
const standortId = ref<string>(standortStore.standardlager?.id ?? '')
const zielStandortId = ref<string>('')
const menge = ref<number>(1)
const sollMenge = ref<number>(0)
const projekt = ref<string>('')
const kommentar = ref<string>('')
const fehler = ref<string>('')
const warnung = ref<string>('')

onMounted(() => {
  if (!standortId.value) {
    standortId.value = standortStore.standardlager?.id ?? ''
  }
})

const artikel = computed(() => artikelStore.artikel.find((a) => a.id === artikelId.value) ?? null)
const standardStandort = computed(() => standortStore.standardlager)

const zielErforderlich = computed(() => typ.value === 'umlagerung')
const mengeErforderlich = computed(() => typ.value !== 'inventur')
const sollMengeErforderlich = computed(() => typ.value === 'inventur')

async function speichern(): Promise<void> {
  fehler.value = ''
  warnung.value = ''
  if (!artikelId.value) {
    fehler.value = 'Artikel fehlt'
    return
  }
  if (mengeErforderlich.value && (!menge.value || menge.value <= 0)) {
    fehler.value = 'Menge muss > 0 sein'
    return
  }
  if (sollMengeErforderlich.value && (sollMenge.value < 0 || Number.isNaN(sollMenge.value))) {
    fehler.value = 'Soll-Menge fehlt oder ungültig'
    return
  }
  if (!standortId.value) {
    fehler.value = 'Standort fehlt'
    return
  }
  if (typ.value === 'umlagerung' && !zielStandortId.value) {
    fehler.value = 'Zielstandort fehlt'
    return
  }
  if (typ.value === 'umlagerung' && zielStandortId.value === standortId.value) {
    fehler.value = 'Quell- und Zielstandort sind identisch'
    return
  }
  const erstelltVon = settings.settings.aktuellerBenutzer.trim() || 'unbekannt'
  try {
    if (typ.value === 'einlagerung') {
      await buchungStore.mu.einlagerung({
        artikelId: artikelId.value,
        standortId: standortId.value,
        menge: menge.value,
        projekt: projekt.value || null,
        erstelltVon,
        kommentar: kommentar.value || null,
      })
    } else if (typ.value === 'entnahme') {
      const res = await buchungStore.mu.entnahme({
        artikelId: artikelId.value,
        standortId: standortId.value,
        menge: menge.value,
        projekt: projekt.value || null,
        erstelltVon,
        kommentar: kommentar.value || null,
      })
      if (res.warnung instanceof NegativerBestandWarnung) {
        warnung.value = t('view.buchung.form.warnNegativ')
      }
    } else if (typ.value === 'umlagerung') {
      const res = await buchungStore.mu.umlagerung({
        artikelId: artikelId.value,
        vonId: standortId.value,
        nachId: zielStandortId.value,
        menge: menge.value,
        projekt: projekt.value || null,
        erstelltVon,
        kommentar: kommentar.value || null,
      })
      if (res.warnung instanceof NegativerBestandWarnung) {
        warnung.value = t('view.buchung.form.warnNegativ')
      }
    } else if (typ.value === 'inventur') {
      await buchungStore.mu.inventur({
        artikelId: artikelId.value,
        standortId: standortId.value,
        sollMenge: sollMenge.value,
        erstelltVon,
        kommentar: kommentar.value || null,
      })
    }
    void router.push(artikel.value ? `/artikel/${artikel.value.id}` : '/buchungen')
  } catch (e) {
    if (e instanceof PflichtfeldFehltError) {
      fehler.value = 'Pflichtfeld: ' + e.message
    } else {
      fehler.value = String(e)
    }
  }
}

function abbrechen(): void {
  if (artikel.value) void router.push(`/artikel/${artikel.value.id}`)
  else void router.push('/buchungen')
}
</script>

<template>
  <section class="view">
    <header class="view-head">
      <h1>{{ t('view.buchung.form.h1') }}</h1>
      <RouterLink to="/buchungen" class="btn">{{ t('view.buchung.form.abbrechen') }}</RouterLink>
    </header>

    <div class="card">
      <form class="form" @submit.prevent="speichern">
        <label>
          <span>{{ t('view.buchung.form.typ') }}</span>
          <select v-model="typ">
            <option v-for="opt in typen" :key="opt" :value="opt">
              {{ t(`view.buchung.form.typen.${opt}`) }}
            </option>
          </select>
        </label>

        <label>
          <span>{{ t('view.buchung.form.artikel') }} *</span>
          <select v-model="artikelId" required>
            <option value="" disabled>— wählen —</option>
            <option v-for="a in artikelStore.artikel" :key="a.id" :value="a.id">
              {{ a.titel }}
            </option>
          </select>
        </label>

        <label>
          <span>{{ t('view.buchung.form.standort') }} *</span>
          <select v-model="standortId" required>
            <option v-for="s in standortStore.aktive" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>
        </label>

        <label v-if="zielErforderlich">
          <span>{{ t('view.buchung.form.zielstandort') }} *</span>
          <select v-model="zielStandortId" required>
            <option value="" disabled>— wählen —</option>
            <option v-for="s in standortStore.aktive" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>
        </label>

        <div class="row">
          <label v-if="mengeErforderlich">
            <span>{{ t('view.buchung.form.menge') }} *</span>
            <input v-model.number="menge" type="number" min="1" required />
          </label>
          <label v-if="sollMengeErforderlich">
            <span>{{ t('view.buchung.form.sollMenge') }} *</span>
            <input v-model.number="sollMenge" type="number" min="0" required />
          </label>
        </div>

        <label>
          <span>{{ t('view.buchung.form.projekt') }}</span>
          <input v-model="projekt" autocomplete="off" />
        </label>
        <label>
          <span>{{ t('view.buchung.form.kommentar') }}</span>
          <input v-model="kommentar" autocomplete="off" />
        </label>

        <p v-if="fehler" class="fehler">{{ fehler }}</p>
        <p v-if="warnung" class="hint hint-warn">{{ warnung }}</p>

        <div class="form-actions">
          <button type="submit" class="primary">{{ t('view.buchung.form.speichern') }}</button>
          <button type="button" @click="abbrechen">
            {{ t('view.buchung.form.abbrechen') }}
          </button>
        </div>

        <p v-if="standardStandort" class="hint">Standard-Standort: {{ standardStandort.name }}</p>
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
