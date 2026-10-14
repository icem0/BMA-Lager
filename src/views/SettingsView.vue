<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useStandortStore } from '../stores/standort'
import { useAuthStore } from '../stores/auth'

const { t } = useI18n()
const router = useRouter()
const settings = useSettingsStore()
const standort = useStandortStore()
const auth = useAuthStore()

const sprache = ref(settings.settings.sprache)
const benutzer = ref(settings.settings.aktuellerBenutzer)
const standardId = ref<string>(settings.settings.standardStandortId ?? '')

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

function abmelden(): void {
  auth.abmelden()
  void router.push('/login')
}
</script>

<template>
  <section class="view">
    <header class="view-head">
      <h1>{{ t('view.settings.h1') }}</h1>
    </header>

    <div class="card">
      <form class="form" @submit.prevent="speichern">
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

        <div class="form-actions">
          <button type="submit" class="primary">{{ t('view.settings.speichern') }}</button>
          <span v-if="statusmeldung" class="hint hint-ok">{{ statusmeldung }}</span>
        </div>
      </form>
    </div>

    <h2>Account</h2>
    <div class="card quick-links">
      <RouterLink to="/passwort-aendern">Passwort ändern</RouterLink>
      <button type="button" class="danger" @click="abmelden">Abmelden</button>
    </div>

    <h2 v-if="auth.istAdmin">Administration</h2>
    <div v-if="auth.istAdmin" class="card quick-links">
      <RouterLink to="/einstellungen/user">Benutzer-Verwaltung</RouterLink>
    </div>

    <h2>Daten</h2>
    <div class="card quick-links">
      <RouterLink to="/import">CSV-Import &amp; Backup</RouterLink>
    </div>

    <h2>Stammdaten</h2>
    <div class="card quick-links">
      <RouterLink to="/einstellungen/typen">Artikel-Typen verwalten</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.quick-links {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.quick-links a,
.quick-links button {
  display: inline-flex;
  padding: 0.4rem 0;
  font-weight: 500;
  width: max-content;
}
</style>
