<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useArtikelStore } from '../stores/artikel'
import { useBuchungStore } from '../stores/buchung'
import { useStandortStore } from '../stores/standort'

const { t } = useI18n()
const artikelStore = useArtikelStore()
const buchungStore = useBuchungStore()
const standortStore = useStandortStore()

const artikelAnzahl = computed(() => artikelStore.gefiltert.length)
const standortAnzahl = computed(() => standortStore.aktive.length)
const buchungsAnzahl = computed(() => buchungStore.buchungen.length)

const leer = computed(
  () => artikelAnzahl.value === 0 && standortAnzahl.value === 0 && buchungsAnzahl.value === 0,
)
</script>

<template>
  <section class="view">
    <h1>{{ t('view.dashboard.h1') }}</h1>

    <p v-if="leer">{{ t('view.dashboard.leer') }}</p>

    <ul v-else class="stats">
      <li>
        <strong>{{ artikelAnzahl }}</strong>
        <span>{{ t('app.nav.artikel') }}</span>
      </li>
      <li>
        <strong>{{ standortAnzahl }}</strong>
        <span>{{ t('app.nav.standorte') }}</span>
      </li>
      <li>
        <strong>{{ buchungsAnzahl }}</strong>
        <span>{{ t('app.nav.buchungen') }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.stats {
  display: flex;
  gap: 1.5rem;
  list-style: none;
  padding: 0;
}
.stats li {
  display: flex;
  flex-direction: column;
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 6px;
  min-width: 7rem;
}
.stats strong {
  font-size: 1.8rem;
}
</style>
