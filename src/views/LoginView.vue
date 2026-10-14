<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { version, commit, branch, buildDate } from '../version'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const passwort = ref('')
const fehler = ref('')
const laufend = ref(false)

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

function zeigeInfo(): void {
  alert('Bitte einen Admin darum, dein Passwort zurückzusetzen (über die Benutzer-Verwaltung).')
}

const versionLabel = `v${version} · ${commit}`
const buildDateFormatiert = new Date(buildDate).toLocaleString()
const versionOffen = ref(false)
function toggleVersion(): void {
  versionOffen.value = !versionOffen.value
}
function closeVersion(): void {
  versionOffen.value = false
}
</script>

<template>
  <section class="login">
    <div class="card login-card">
      <div class="brand">
        <img src="/bma-lager-logo.png" alt="" width="48" height="48" />
        <h1>BMA-Lager</h1>
      </div>
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
      <button type="button" @click="closeVersion">Schließen</button>
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
</style>
