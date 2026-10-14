<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

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
</script>

<template>
  <section class="login">
    <div class="card login-card">
      <div class="brand">
        <img src="/logo.png" alt="" width="48" height="48" />
        <h1>BMA-Lager</h1>
      </div>
      <p class="hint">Bitte mit E-Mail und Passwort anmelden.</p>

      <form class="form" @submit.prevent="anmelden">
        <label>
          <span>E-Mail</span>
          <input v-model="email" type="email" autocomplete="username" required autofocus />
        </label>
        <label>
          <span>Passwort</span>
          <input v-model="passwort" type="password" autocomplete="current-password" required />
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
</style>
