<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useArtikelTypen } from '../composables/useArtikelTypen'

const settings = useSettingsStore()
const { typVerwendungen } = useArtikelTypen()

const lokaleListe = ref<string[]>([])
const speicherStatus = ref('')
const ungueltigeEingabe = ref('')
const neueEingabe = ref('')

watch(
  () => settings.settings.artikelTypen,
  (list) => {
    lokaleListe.value = [...list]
  },
  { immediate: true },
)

function hinzufuegen(): void {
  const wert = neueEingabe.value.trim()
  if (!wert) {
    ungueltigeEingabe.value = 'Name darf nicht leer sein.'
    return
  }
  if (lokaleListe.value.includes(wert)) {
    ungueltigeEingabe.value = `"${wert}" ist bereits in der Liste.`
    return
  }
  lokaleListe.value.push(wert)
  neueEingabe.value = ''
  ungueltigeEingabe.value = ''
  void speichern()
}

function entfernen(typ: string): void {
  const eintrag = typVerwendungen.value.find((t) => t.typ === typ)
  if (eintrag && eintrag.anzahl > 0) return
  lokaleListe.value = lokaleListe.value.filter((t) => t !== typ)
  void speichern()
}

function hoch(typ: string): void {
  const idx = lokaleListe.value.indexOf(typ)
  if (idx <= 0) return
  const liste = [...lokaleListe.value]
  const vorher = liste[idx - 1]
  const aktuell = liste[idx]
  if (!vorher || !aktuell) return
  liste[idx - 1] = aktuell
  liste[idx] = vorher
  lokaleListe.value = liste
  void speichern()
}

function runter(typ: string): void {
  const idx = lokaleListe.value.indexOf(typ)
  if (idx < 0 || idx >= lokaleListe.value.length - 1) return
  const liste = [...lokaleListe.value]
  const nachher = liste[idx + 1]
  const aktuell = liste[idx]
  if (!nachher || !aktuell) return
  liste[idx] = nachher
  liste[idx + 1] = aktuell
  lokaleListe.value = liste
  void speichern()
}

async function speichern(): Promise<void> {
  await settings.setArtikelTypen(lokaleListe.value)
  speicherStatus.value = 'gespeichert'
  setTimeout(() => {
    speicherStatus.value = ''
  }, 1500)
}
</script>

<template>
  <section class="view">
    <p class="hint">
      <RouterLink to="/einstellungen">← zurück zu Einstellungen</RouterLink>
    </p>
    <header class="view-head">
      <h1>Artikel-Typen</h1>
    </header>
    <p class="hint">
      Die Typen erscheinen als Auswahl in der Artikel-Form und im Filter der Artikel-Liste.
      Reihenfolge = Anzeige-Reihenfolge.
    </p>

    <div class="card">
      <form class="form new-type" @submit.prevent="hinzufuegen">
        <label>
          <span>Neuer Typ</span>
          <input
            v-model="neueEingabe"
            type="text"
            placeholder="z. B. Verteilerdose"
            autocomplete="off"
          />
        </label>
        <button type="submit" class="primary">Hinzufügen</button>
      </form>
      <p v-if="ungueltigeEingabe" class="fehler">{{ ungueltigeEingabe }}</p>
    </div>

    <h2>Konfigurierte Typen</h2>
    <ul v-if="lokaleListe.length > 0" class="typ-list">
      <li v-for="(typ, idx) in lokaleListe" :key="typ" class="card typ-row">
        <span class="typ-name">{{ typ }}</span>
        <span class="typ-meta">
          {{ typVerwendungen.find((t) => t.typ === typ)?.anzahl ?? 0 }} Artikel
        </span>
        <span class="typ-actions">
          <button
            type="button"
            :disabled="idx === 0"
            :title="idx === 0 ? 'ist oben' : 'nach oben'"
            @click="hoch(typ)"
          >
            ↑
          </button>
          <button
            type="button"
            :disabled="idx === lokaleListe.length - 1"
            :title="idx === lokaleListe.length - 1 ? 'ist unten' : 'nach unten'"
            @click="runter(typ)"
          >
            ↓
          </button>
          <button
            type="button"
            class="danger"
            :disabled="(typVerwendungen.find((t) => t.typ === typ)?.anzahl ?? 0) > 0"
            :title="
              (typVerwendungen.find((t) => t.typ === typ)?.anzahl ?? 0) > 0
                ? 'Typ wird noch von Artikeln verwendet – erst zuordnen oder archivieren'
                : 'entfernen'
            "
            @click="entfernen(typ)"
          >
            Entfernen
          </button>
        </span>
      </li>
    </ul>
    <p v-else class="empty-state">Keine Typen konfiguriert.</p>

    <template v-if="typVerwendungen.some((t) => t.verwaist)">
      <h2>Verwaiste Typen (nur in Artikeln)</h2>
      <ul class="typ-list">
        <li
          v-for="eintrag in typVerwendungen.filter((x) => x.verwaist)"
          :key="eintrag.typ"
          class="card typ-row"
        >
          <span class="typ-name">{{ eintrag.typ }}</span>
          <span class="typ-meta">{{ eintrag.anzahl }} Artikel</span>
          <span class="typ-actions">
            <button type="button" class="primary" @click="lokaleListe.push(eintrag.typ)">
              Übernehmen
            </button>
          </span>
        </li>
      </ul>
    </template>

    <p v-if="speicherStatus" class="hint hint-ok">{{ speicherStatus }}</p>
  </section>
</template>

<style scoped>
.new-type {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  align-items: end;
}
.new-type label {
  margin: 0;
}

.typ-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.typ-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.7rem 1rem;
}

.typ-name {
  font-weight: 600;
  color: var(--text-strong);
}

.typ-meta {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.typ-actions {
  display: flex;
  gap: 0.3rem;
}

@media (max-width: 640px) {
  .typ-row {
    grid-template-columns: 1fr;
  }
  .typ-actions {
    justify-content: flex-end;
  }
}
</style>
