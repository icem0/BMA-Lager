<script setup lang="ts">
// Settings-View: Sprache, Benutzer-Name, Standard-Standort.
// Persistiert in `einstellungen`-Tabelle via useSettingsStore.

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useStandortStore } from '../stores/standort'

const { t } = useI18n()
const settings = useSettingsStore()
const standort = useStandortStore()

// Lokale Bearbeitungs-Klone, die beim "Speichern" in den Store geschrieben werden.
const sprache = ref(settings.settings.sprache)
const benutzer = ref(settings.settings.aktuellerBenutzer)
const standardId = ref<string>(settings.settings.standardStandortId ?? '')

// Sobald der Store von IndexedDB nachlädt, das Formular nachziehen.
watch(
  () => settings.settings,
  (s) => {
    sprache.value = s.sprache
    benutzer.value = s.aktuellerBenutzer
    standardId.value = s.standardStandortId ?? ''
  },
)

const standorte = computed(() => standort.aktive)
const statusmeldung = ref('')

async function speichern(): Promise<void> {
  await settings.setSprache(sprache.value)
  await settings.setBenutzer(benutzer.value.trim())
  await settings.setStandardStandort(standardId.value || null)
  statusmeldung.value = t('view.settings.gespeichert')
  setTimeout(() => {
    statusmeldung.value = ''
  }, 1500)
}
</script>

<template>
  <section class="view">
    <h1>{{ t('view.settings.h1') }}</h1>

    <div class="form">
      <label>
        <span>{{ t('view.settings.sprache') }}</span>
        <select v-model="sprache">
          <option value="de">{{ t('view.settings.sprachen.de') }}</option>
          <option value="en">{{ t('view.settings.sprachen.en') }}</option>
        </select>
      </label>

      <label>
        <span>{{ t('view.settings.benutzer') }}</span>
        <input v-model="benutzer" type="text" autocomplete="off" />
      </label>

      <label>
        <span>{{ t('view.settings.standardStandort') }}</span>
        <select v-model="standardId">
          <option value="">— {{ t('view.settings.nichtGelegt') }} —</option>
          <option v-for="s in standorte" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>

      <div class="actions">
        <button type="button" @click="speichern">{{ t('view.settings.speichern') }}</button>
        <span v-if="statusmeldung" class="hint">{{ statusmeldung }}</span>
      </div>
    </div>

    <h2>Daten</h2>
    <p>
      <RouterLink to="/import">CSV-Import &amp; Backup</RouterLink>
    </p>
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
  gap: 0.75rem;
  align-items: center;
}
.hint {
  color: #0a7a3a;
  font-size: 0.9em;
}
</style>
