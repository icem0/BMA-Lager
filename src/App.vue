<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watchEffect, computed } from 'vue'
import { RouterLink, useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from './stores/settings'
import { useStandortStore } from './stores/standort'
import { useArtikelStore } from './stores/artikel'
import { useBuchungStore } from './stores/buchung'
import { useProjektStore } from './stores/projekt'
import { useAuditStore } from './stores/audit'
import { useAuthStore } from './stores/auth'
import { useSyncStore } from './stores/sync'
import { getApiBaseUrl } from './auth/api'
import { version, commit, branch, buildDate } from './version'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()

const settings = useSettingsStore()
const standort = useStandortStore()
const artikel = useArtikelStore()
const buchung = useBuchungStore()
const projekt = useProjektStore()
const audit = useAuditStore()
const auth = useAuthStore()
const sync = useSyncStore()

// Public-Routen zeigen kein Header-Layout.
const istPublicRoute = computed(() => route.meta.public === true)

const online = ref(navigator.onLine)
function onOnline(): void {
  online.value = true
}
function onOffline(): void {
  online.value = false
}

const versionOffen = ref(false)
function toggleVersion(): void {
  versionOffen.value = !versionOffen.value
}
function closeVersion(): void {
  versionOffen.value = false
}

function onDocumentClick(e: MouseEvent): void {
  if (!versionOffen.value) return
  const ziel = e.target as HTMLElement | null
  if (ziel && !ziel.closest('.version-badge, .version-panel')) closeVersion()
}

const themeUmschalter = ref<'dark' | 'light' | 'auto'>(
  (localStorage.getItem('theme') as 'dark' | 'light' | 'auto' | null) ?? 'dark',
)
watchEffect(() => {
  const wert = themeUmschalter.value
  localStorage.setItem('theme', wert)
  const root = document.documentElement
  if (wert === 'dark') {
    root.setAttribute('data-theme', 'dark')
  } else if (wert === 'light') {
    root.setAttribute('data-theme', 'light')
  } else {
    root.removeAttribute('data-theme')
  }
})

onMounted(() => {
  // Stores nur dann starten, wenn eine Session existiert. Das verhindert
  // data-leaks zwischen Login-Versuchen.
  if (auth.istAngemeldet) {
    settings.start()
    standort.start()
    artikel.start()
    buchung.start()
    projekt.start()
    audit.start()
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  window.addEventListener('click', onDocumentClick)
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
  window.removeEventListener('click', onDocumentClick)
})

// Wenn sich der Login-Status ändert, Stores entsprechend starten/stoppen.
watchEffect(() => {
  if (auth.istAngemeldet) {
    settings.start()
    standort.start()
    artikel.start()
    buchung.start()
    projekt.start()
    audit.start()
    sync.start({
      apiBase: getApiBaseUrl(),
      getToken: () => (auth.session?.jwtExpiresAt ? localStorage.getItem('bma.auth.jwt') : null),
      intervalSek: 30,
    })
  } else {
    settings.stop()
    standort.stop()
    artikel.stop()
    buchung.stop()
    projekt.stop()
    audit.stop()
    sync.stop()
  }
})

function abmelden(): void {
  auth.abmelden()
  void router.push('/login')
}

const versionLabel = `v${version} · ${commit}`
const buildDateFormatiert = new Date(buildDate).toLocaleString()
</script>

<template>
  <!-- Public Routes (Login, Passwort vergessen, First-Run-Setup): kein Header. -->
  <template v-if="istPublicRoute">
    <RouterView />
  </template>

  <!-- Geschützte Routes: Header + Sidebar-Indikatoren -->
  <div v-else class="app-shell">
    <div v-if="!online" class="offline-banner" role="status" aria-live="polite">
      <span class="dot"></span>
      Offline – Daten werden lokal gespeichert und sind verfügbar.
    </div>
    <header class="app-header">
      <div class="brand">
        <img src="/logo.png" alt="" class="brand-logo" width="32" height="32" />
        <strong>{{ t('app.title') }}</strong>
      </div>
      <nav>
        <RouterLink to="/">{{ t('app.nav.dashboard') }}</RouterLink>
        <RouterLink to="/artikel">{{ t('app.nav.artikel') }}</RouterLink>
        <RouterLink to="/scan" title="Barcode-Scan">📷</RouterLink>
        <RouterLink to="/buchungen">{{ t('app.nav.buchungen') }}</RouterLink>
        <RouterLink to="/standorte">{{ t('app.nav.standorte') }}</RouterLink>
        <RouterLink to="/einstellungen">{{ t('app.nav.einstellungen') }}</RouterLink>
      </nav>
      <div class="header-right">
        <div v-if="auth.session" class="user-chip" :title="`Angemeldet als ${auth.session.email}`">
          <span class="user-role">{{ auth.rolle ?? 'user' }}</span>
          <span class="user-email">{{ auth.session.email }}</span>
          <button type="button" class="logout-btn" title="Abmelden" @click="abmelden">⏻</button>
        </div>
        <button
          type="button"
          class="theme-toggle"
          :title="`Theme: ${themeUmschalter}`"
          @click="
            themeUmschalter =
              themeUmschalter === 'dark' ? 'light' : themeUmschalter === 'light' ? 'auto' : 'dark'
          "
        >
          {{ themeUmschalter === 'dark' ? '🌙' : themeUmschalter === 'light' ? '☀️' : '🖥️' }}
        </button>
        <button
          type="button"
          class="version-badge"
          :title="`Build ${commit}`"
          @click.stop="toggleVersion"
        >
          {{ versionLabel }}
        </button>
        <span
          class="online-dot"
          :class="{
            online: online && sync.status.status !== 'error',
            offline: !online || sync.status.status === 'offline' || sync.status.status === 'error',
            syncing: sync.status.status === 'syncing',
          }"
          :title="
            `Sync: ${sync.status.status}` +
            (sync.status.lastError ? ` (${sync.status.lastError})` : '')
          "
        ></span>
        <span
          v-if="sync.status.pending > 0"
          class="sync-badge"
          :title="`${sync.status.pending} ausstehend`"
        >
          {{ sync.status.pending }}
        </span>
      </div>
    </header>
    <main>
      <RouterView />
    </main>

    <div v-if="versionOffen" class="version-panel" role="dialog">
      <h2>Build-Info</h2>
      <dl class="meta">
        <div>
          <dt>Version</dt>
          <dd>v{{ version }}</dd>
        </div>
        <div>
          <dt>Commit</dt>
          <dd>{{ commit }}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd>{{ branch }}</dd>
        </div>
        <div>
          <dt>Build-Datum</dt>
          <dd>{{ buildDateFormatiert }}</dd>
        </div>
      </dl>
      <p class="hint">
        Zum Reproduzieren:
        <code>git checkout {{ commit }}</code>
      </p>
      <button type="button" @click="closeVersion">Schließen</button>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.offline-banner {
  background: var(--warning);
  color: #1a1206;
  text-align: center;
  padding: 0.45rem 1rem;
  font-size: 0.85rem;
  font-weight: 500;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
}
.offline-banner .dot {
  width: 0.6rem;
  height: 0.6rem;
  background: #1a1206;
  border-radius: 50%;
  display: inline-block;
}

.app-header {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  padding: 0.7rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--bg-header);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.brand strong {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.brand-logo {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: white;
  padding: 2px;
}

.app-header nav {
  display: flex;
  gap: 0.25rem;
  flex: 1;
}

.app-header nav a {
  color: var(--text-muted);
  padding: 0.4rem 0.7rem;
  border-radius: var(--radius-sm);
  font-weight: 500;
  font-size: 0.92rem;
  text-decoration: none;
  transition:
    background 0.15s,
    color 0.15s;
}

.app-header nav a:hover {
  background: rgba(99, 102, 241, 0.06);
  color: var(--text-strong);
  text-decoration: none;
}

.app-header nav a.router-link-active {
  background: var(--accent-bg);
  color: var(--accent);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.2rem 0.4rem 0.2rem 0.5rem;
  font-size: 0.78rem;
}

.user-role {
  background: var(--accent-bg);
  color: var(--accent);
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.7rem;
}

.user-email {
  color: var(--text-strong);
  font-weight: 500;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logout-btn {
  background: transparent;
  border: none;
  padding: 0.15rem 0.4rem;
  font-size: 1rem;
  cursor: pointer;
  border-radius: 999px;
  line-height: 1;
}
.logout-btn:hover {
  background: rgba(248, 113, 113, 0.15);
  color: var(--danger);
}

.theme-toggle {
  padding: 0.3rem 0.5rem;
  font-size: 1rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.online-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  display: inline-block;
}

.online-dot.online {
  background: var(--success);
  box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.15);
}

.online-dot.offline {
  background: var(--danger);
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.15);
}

.online-dot.syncing {
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  animation: pulse 1.4s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.sync-badge {
  background: var(--warning);
  color: #1a1206;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  min-width: 1.5rem;
  text-align: center;
}

.version-badge {
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1px solid var(--border-strong);
  padding: 0.3rem 0.55rem;
  border-radius: var(--radius-sm);
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
}

.version-badge:hover {
  background: var(--bg-card);
  color: var(--text-strong);
  border-color: var(--accent-border);
}

.version-panel {
  position: fixed;
  top: 4rem;
  right: 1rem;
  width: 22rem;
  background: var(--bg-card);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 1rem 1.25rem;
  box-shadow: var(--shadow-pop);
  z-index: 1000;
}

.version-panel h2 {
  margin: 0 0 0.75rem;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.version-panel .meta {
  grid-template-columns: 1fr;
  gap: 0.4rem 0;
  margin-bottom: 0.75rem;
}

.version-panel .meta dt {
  font-size: 0.72rem;
}

.version-panel dd {
  font-family: var(--mono);
  font-size: 0.85rem;
}

.version-panel code {
  background: var(--bg-input);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-family: var(--mono);
  font-size: 0.8rem;
}

main {
  flex: 1;
}

@media (max-width: 720px) {
  .app-header {
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
  }
  .app-header nav {
    order: 3;
    flex-basis: 100%;
    justify-content: center;
    flex-wrap: wrap;
  }
  .brand {
    flex: 1;
  }
  .user-email {
    display: none;
  }
}
</style>
