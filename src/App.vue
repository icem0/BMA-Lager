<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from './stores/settings'
import { useStandortStore } from './stores/standort'
import { useArtikelStore } from './stores/artikel'
import { useBuchungStore } from './stores/buchung'
import { useProjektStore } from './stores/projekt'
import { useAuditStore } from './stores/audit'

const { t } = useI18n()

// Alle Stores hier zentral starten, damit die `liveQuery`-Subscriptions
// app-weit aktiv sind (analog zu einem AppShell-Bootstrap).
const settings = useSettingsStore()
const standort = useStandortStore()
const artikel = useArtikelStore()
const buchung = useBuchungStore()
const projekt = useProjektStore()
const audit = useAuditStore()

const online = ref(navigator.onLine)
function onOnline(): void {
  online.value = true
}
function onOffline(): void {
  online.value = false
}

onMounted(() => {
  settings.start()
  standort.start()
  artikel.start()
  buchung.start()
  projekt.start()
  audit.start()
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
})

onBeforeUnmount(() => {
  settings.stop()
  standort.stop()
  artikel.stop()
  buchung.stop()
  projekt.stop()
  audit.stop()
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})
</script>

<template>
  <div class="app-shell">
    <div v-if="!online" class="offline-banner" role="status" aria-live="polite">
      Offline – Daten werden lokal gespeichert und sind verfügbar.
    </div>
    <header class="app-header">
      <strong>{{ t('app.title') }}</strong>
      <nav>
        <RouterLink to="/">{{ t('app.nav.dashboard') }}</RouterLink>
        <RouterLink to="/artikel">{{ t('app.nav.artikel') }}</RouterLink>
        <RouterLink to="/buchungen">{{ t('app.nav.buchungen') }}</RouterLink>
        <RouterLink to="/standorte">{{ t('app.nav.standorte') }}</RouterLink>
        <RouterLink to="/einstellungen">{{ t('app.nav.einstellungen') }}</RouterLink>
      </nav>
      <span
        class="online-dot"
        :class="{ online: online, offline: !online }"
        :title="online ? 'online' : 'offline'"
      ></span>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, sans-serif;
}
.offline-banner {
  background: #b07500;
  color: white;
  text-align: center;
  padding: 0.4rem 1rem;
  font-size: 0.9rem;
}
.app-header {
  display: flex;
  gap: 1.5rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #ddd;
  background: #0b3d91;
  color: white;
}
.app-header nav {
  display: flex;
  gap: 1rem;
  flex: 1;
}
.app-header nav a {
  color: white;
  text-decoration: none;
}
.app-header nav a.router-link-active {
  text-decoration: underline;
}
.online-dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  display: inline-block;
}
.online-dot.online {
  background: #0a7a3a;
}
.online-dot.offline {
  background: #b00020;
}
main {
  flex: 1;
  padding: 1rem;
}
</style>
