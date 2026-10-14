<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useBuchungStore } from '../stores/buchung'
import { useAuthStore } from '../stores/auth'
import type { Buchung } from '../db/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const buchungStore = useBuchungStore()
const auth = useAuthStore()

const buchungId = computed<string>(() => String(route.params.buchungId ?? ''))
const original = computed<Buchung | undefined>(() =>
  buchungStore.buchungen.find((b) => b.id === buchungId.value),
)
const neuesProjekt = ref<string>('')
const fehler = ref<string>('')

async function speichern(): Promise<void> {
  fehler.value = ''
  if (!original.value) {
    fehler.value = 'Buchung nicht gefunden.'
    return
  }
  if (!neuesProjekt.value.trim()) {
    fehler.value = 'Projekt fehlt.'
    return
  }
  const erstelltVon = auth.anzeigename.trim() || 'unbekannt'
  try {
    await buchungStore.mu.kommission({
      buchungId: original.value.id,
      neuesProjekt: neuesProjekt.value.trim(),
      erstelltVon,
    })
    void router.push(`/artikel/${original.value.artikelId}`)
  } catch (e) {
    fehler.value = String(e)
  }
}

function abbrechen(): void {
  if (original.value) void router.push(`/artikel/${original.value.artikelId}`)
  else void router.push('/buchungen')
}
</script>

<template>
  <section v-if="original" class="view">
    <header class="view-head">
      <h1>{{ t('view.kommission.h1') }}</h1>
    </header>

    <p class="hint">{{ t('view.kommission.erklaerung') }}</p>

    <div class="card">
      <dl class="meta">
        <div>
          <dt>Original-Menge</dt>
          <dd>{{ original.menge }}</dd>
        </div>
        <div>
          <dt>Original-Projekt</dt>
          <dd>{{ original.projekt ?? '—' }}</dd>
        </div>
      </dl>
    </div>

    <div class="card">
      <form class="form" @submit.prevent="speichern">
        <label>
          <span>{{ t('view.kommission.neuesProjekt') }} *</span>
          <input v-model="neuesProjekt" required autocomplete="off" />
        </label>

        <p v-if="fehler" class="fehler">{{ fehler }}</p>

        <div class="form-actions">
          <button type="submit" class="primary">{{ t('view.kommission.speichern') }}</button>
          <button type="button" @click="abbrechen">{{ t('view.kommission.abbrechen') }}</button>
        </div>
      </form>
    </div>
  </section>
  <section v-else class="view">
    <p class="muted">Lade…</p>
  </section>
</template>
