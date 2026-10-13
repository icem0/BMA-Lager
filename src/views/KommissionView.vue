<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useBuchungStore } from '../stores/buchung'
import { useSettingsStore } from '../stores/settings'
import type { Buchung } from '../db/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const buchungStore = useBuchungStore()
const settings = useSettingsStore()

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
  const erstelltVon = settings.settings.aktuellerBenutzer.trim() || 'unbekannt'
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
    <h1>{{ t('view.kommission.h1') }}</h1>
    <p>{{ t('view.kommission.erklaerung') }}</p>

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

    <form class="form" @submit.prevent="speichern">
      <label>
        <span>{{ t('view.kommission.neuesProjekt') }} *</span>
        <input v-model="neuesProjekt" required autocomplete="off" />
      </label>

      <p v-if="fehler" class="fehler">{{ fehler }}</p>

      <div class="actions">
        <button type="submit">{{ t('view.kommission.speichern') }}</button>
        <button type="button" @click="abbrechen">{{ t('view.kommission.abbrechen') }}</button>
      </div>
    </form>
  </section>
  <section v-else class="view">
    <p>Lade…</p>
  </section>
</template>

<style scoped>
.view {
  max-width: 640px;
}
.meta {
  display: flex;
  gap: 1.5rem;
  margin: 1rem 0;
}
.meta div {
  display: flex;
  flex-direction: column;
}
.meta dt {
  font-weight: 600;
  color: #555;
  font-size: 0.85rem;
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
  gap: 0.5rem;
}
.fehler {
  color: #b00020;
}
</style>
