<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { version, commit, branch, buildDate } from '../version'
import { fuehreSetupDurch, holeSetupStatus, type SetupStatus } from '../auth/users'
import { ApiError } from '../auth/api'

const router = useRouter()
const auth = useAuthStore()

type Modus = 'laden' | 'setup' | 'login'

const modus = ref<Modus>('laden')

// --- Login-Felder ---
const email = ref('')
const passwort = ref('')
const fehler = ref('')
const laufend = ref(false)

// --- Setup-Felder ---
const setupAnzeigename = ref('')
const setupEmail = ref('')
const setupPasswort = ref('')
const setupPasswortBestaetigen = ref('')
const setupFehler = ref('')
const setupLaufend = ref(false)

async function ladeSetupStatus(): Promise<void> {
  modus.value = 'laden'
  try {
    const status: SetupStatus = await holeSetupStatus()
    modus.value = status.setupRequired ? 'setup' : 'login'
  } catch (e) {
    // Server nicht erreichbar o. ä. — Login anbieten, Fehler dem User zeigen.
    modus.value = 'login'
    fehler.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(() => {
  void ladeSetupStatus()
})

async function anmelden(): Promise<void> {
  fehler.value = ''
  if (!email.value.trim() || !passwort.value) {
    fehler.value = 'Bitte E-Mail und Passwort eingeben.'
    return
  }
  laufend.value = true
  try {
    await auth.anmelden(email.value, passwort.value, { offlineFallback: true })
    if (auth.mussPasswortAendern) {
      void router.push('/passwort-aendern')
    } else {
      void router.push('/')
    }
  } catch (e) {
    fehler.value = e instanceof Error ? e.message : String(e)
  } finally {
    laufend.value = false
  }
}

async function setupAbschliessen(): Promise<void> {
  setupFehler.value = ''

  if (!setupAnzeigename.value.trim()) {
    setupFehler.value = 'Bitte einen Anzeigenamen eingeben.'
    return
  }
  if (!setupEmail.value.trim()) {
    setupFehler.value = 'Bitte eine E-Mail eingeben.'
    return
  }
  if (setupPasswort.value.length < 8) {
    setupFehler.value = 'Passwort muss mindestens 8 Zeichen haben.'
    return
  }
  if (setupPasswort.value !== setupPasswortBestaetigen.value) {
    setupFehler.value = 'Passwörter stimmen nicht überein.'
    return
  }

  setupLaufend.value = true
  try {
    await fuehreSetupDurch({
      anzeigename: setupAnzeigename.value.trim(),
      email: setupEmail.value.trim(),
      passwort: setupPasswort.value,
    })
    // Server hat den User angelegt — jetzt regulär einloggen.
    await auth.anmelden(setupEmail.value.trim(), setupPasswort.value, { offlineFallback: false })
    void router.push('/')
  } catch (e) {
    if (e instanceof ApiError && e.code === 'SETUP_DONE') {
      // In der Zwischenzeit hat jemand anderes den Setup gemacht.
      setupFehler.value = 'Setup ist bereits abgeschlossen. Bitte anmelden.'
      modus.value = 'login'
      email.value = setupEmail.value.trim()
      return
    }
    setupFehler.value = e instanceof Error ? e.message : String(e)
  } finally {
    setupLaufend.value = false
  }
}

function zeigeInfo(): void {
  alert('Bitte einen Admin darum, dein Passwort zurückzusetzen (über die Benutzer-Verwaltung).')
}

const versionLabel = `v${version} · ${commit}`
const buildDateFormatiert = new Date(buildDate).toLocaleString()
const versionOffen = ref(false)
const copyStatus = ref<'idle' | 'ok' | 'fehler'>('idle')
let copyResetTimer: ReturnType<typeof setTimeout> | null = null

// Einzeiliger Build-String fuer Copy/Paste in Bug-Reports o. ae.
// Format: bma-lager v0.1.0 (commit f0ad4fe, branch main, built 14.10.2026 12:55:22)
const versionString = `bma-lager v${version} (commit ${commit}, branch ${branch}, built ${buildDateFormatiert})`

function toggleVersion(): void {
  versionOffen.value = !versionOffen.value
}
function closeVersion(): void {
  versionOffen.value = false
}

async function copyVersion(): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(versionString)
    } else {
      // Fallback fuer aelteres Browser/WebView ohne Clipboard-API.
      const ta = document.createElement('textarea')
      ta.value = versionString
      ta.setAttribute('readonly', '')
      ta.style.position = 'absolute'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      if (!ok) throw new Error('execCommand(copy) fehlgeschlagen')
    }
    copyStatus.value = 'ok'
  } catch {
    copyStatus.value = 'fehler'
  } finally {
    if (copyResetTimer !== null) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
      copyStatus.value = 'idle'
    }, 2000)
  }
}
</script>

<template>
  <section class="login">
    <div class="card login-card">
      <div class="brand">
        <img src="/bma-lager-logo.png" alt="" width="48" height="48" />
        <h1>BMA-Lager</h1>
      </div>

      <!-- Lade-Zustand -->
      <template v-if="modus === 'laden'">
        <p class="hint">Wird geladen …</p>
      </template>

      <!-- Setup-Formular: erster User -->
      <template v-else-if="modus === 'setup'">
        <p class="hint">
          Noch kein Benutzer vorhanden. Lege den ersten Account an, danach läuft der
          Login normal.
        </p>

        <form class="form" @submit.prevent="setupAbschliessen">
          <label>
            <span>Anzeigename</span>
            <input
              v-model="setupAnzeigename"
              name="anzeigename"
              type="text"
              autocomplete="name"
              maxlength="120"
              required
              autofocus
            />
          </label>
          <label>
            <span>E-Mail (Login)</span>
            <input
              v-model="setupEmail"
              name="email"
              type="email"
              autocomplete="email"
              inputmode="email"
              required
            />
          </label>
          <label>
            <span>Passwort</span>
            <input
              v-model="setupPasswort"
              name="password"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            />
          </label>
          <label>
            <span>Passwort bestätigen</span>
            <input
              v-model="setupPasswortBestaetigen"
              name="password-confirm"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            />
          </label>
          <p v-if="setupFehler" class="fehler">{{ setupFehler }}</p>

          <div class="form-actions">
            <button type="submit" class="primary" :disabled="setupLaufend">
              {{ setupLaufend ? 'Wird angelegt …' : 'Account anlegen' }}
            </button>
          </div>
        </form>
      </template>

      <!-- Login-Formular -->
      <template v-else>
        <p class="hint">Bitte mit E-Mail und Passwort anmelden.</p>

        <form class="form" @submit.prevent="anmelden">
          <label>
            <span>E-Mail</span>
            <input
              v-model="email"
              name="email"
              type="email"
              autocomplete="email"
              inputmode="email"
              required
              autofocus
            />
          </label>
          <label>
            <span>Passwort</span>
            <input
              v-model="passwort"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>
          <p v-if="fehler" class="fehler">{{ fehler }}</p>

          <div class="form-actions">
            <button type="submit" class="primary" :disabled="laufend">
              {{ laufend ? 'Anmelden …' : 'Anmelden' }}
            </button>
          </div>
        </form>

        <p class="hint">
          <a href="javascript:void(0)" @click="zeigeInfo">Passwort vergessen?</a>
        </p>
      </template>
    </div>

    <button
      type="button"
      class="version-badge"
      :title="`Build ${commit}`"
      @click.stop="toggleVersion"
    >
      {{ versionLabel }}
    </button>

    <div v-if="versionOffen" class="version-panel" role="dialog" @click.stop>
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
      <div class="version-actions">
        <button type="button" class="copy-btn" @click="copyVersion" :title="versionString">
          <span v-if="copyStatus === 'idle'">In Zwischenablage kopieren</span>
          <span v-else-if="copyStatus === 'ok'">Kopiert ✓</span>
          <span v-else>Kopieren fehlgeschlagen</span>
        </button>
        <button type="button" @click="closeVersion">Schließen</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.login {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem 1rem;
  background: var(--bg-app);
}

.login-card {
  width: 100%;
  max-width: 380px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.brand h1 {
  margin: 0;
  font-size: 1.4rem;
  color: var(--text-strong);
}

.hint {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0.75rem 0 0;
  text-align: center;
}

.version-badge {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
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
  bottom: 3rem;
  right: 1rem;
  width: 22rem;
  max-width: calc(100vw - 2rem);
  background: var(--bg-card);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  box-shadow: var(--shadow);
  z-index: 50;
}

.version-panel h2 {
  margin: 0 0 0.6rem;
  font-size: 1rem;
  color: var(--text-strong);
}

.version-panel .meta {
  display: grid;
  gap: 0.4rem;
  margin: 0 0 0.8rem;
}

.version-panel .meta dt {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-bottom: 0.1rem;
}

.version-panel dd {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.85rem;
  color: var(--text-strong);
}

.version-panel .version-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.version-panel .version-actions button {
  flex: 1 1 auto;
  padding: 0.45rem 0.7rem;
  font-size: 0.8rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--bg-input);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
}

.version-panel .version-actions button:hover {
  background: var(--bg-card);
  border-color: var(--accent-border);
  color: var(--text-strong);
}

.version-panel .version-actions .copy-btn {
  font-family: var(--mono);
}
</style>
