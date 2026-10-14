<script setup lang="ts">
// Barcode-Scan-View: Kamera-Scan mit Direktnavigation in die Buchungsmaske.
// Strategie:
//   - Wenn Artikel mit passender bestellnummer existiert → /buchung/neu?artikelId=...
//   - Sonst: kurzer Dialog "Neuen Artikel anlegen oder weiter scannen?"

import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useArtikelStore } from '../stores/artikel'
import { useBarcode } from '../composables/useBarcode'

const router = useRouter()
const artikelStore = useArtikelStore()
onMounted(() => artikelStore.start())

const videoEl = ref<HTMLVideoElement | null>(null)
const manuelleEingabe = ref('')
const gefunden = ref<string | null>(null)

const {
  start,
  stop,
  aktiv,
  fehler: scannerFehler,
} = useBarcode({
  onDetected: (code, format) => {
    void codeVerarbeiten(code, format)
  },
})

async function codeVerarbeiten(code: string, _format: string): Promise<void> {
  gefunden.value = code
  // Artikel mit dieser bestellnummer suchen
  const artikel = artikelStore.artikel.find((a) => a.bestellnummer === code || a.id === code)
  if (artikel) {
    void router.push({ name: 'buchung-neu', query: { artikelId: artikel.id } })
  } else {
    // Nicht gefunden — User fragen
    const anlegen = confirm(`Code "${code}" nicht im Bestand. Neuen Artikel anlegen?`)
    if (anlegen) {
      void router.push({ name: 'artikel-neu', query: { bestellnummer: code } })
    } else {
      gefunden.value = null
    }
  }
}

function manuellScannen(): void {
  const code = manuelleEingabe.value.trim()
  if (!code) return
  void codeVerarbeiten(code, 'manual')
}

onMounted(async () => {
  await new Promise((r) => setTimeout(r, 100))
  if (videoEl.value) await start(videoEl.value)
})

onBeforeUnmount(() => stop())
</script>

<template>
  <section class="view barcode">
    <header class="view-head">
      <h1>Barcode-Scan</h1>
      <p>Halte die Kamera auf den Barcode des Artikels.</p>
    </header>

    <div class="scanner-area">
      <video v-show="aktiv" ref="videoEl" class="scanner-video" playsinline muted autoplay></video>
      <div v-if="!aktiv && !scannerFehler" class="scanner-placeholder">
        <p>Scanner startet …</p>
      </div>
      <div v-if="scannerFehler" class="scanner-error">
        <p><strong>Kamera nicht verfügbar:</strong> {{ scannerFehler }}</p>
      </div>
      <div v-if="gefunden" class="scanner-found">
        <p>
          Erkannt: <code>{{ gefunden }}</code>
        </p>
      </div>
    </div>

    <div class="manual">
      <h3>Oder Code manuell eingeben</h3>
      <form @submit.prevent="manuellScannen">
        <input v-model="manuelleEingabe" placeholder="EAN, Code-128, …" />
        <button type="submit">Übernehmen</button>
      </form>
    </div>

    <p class="hint">
      Hinweis: Die Kamera-Berechtigung muss im Browser erteilt sein. Auf mobilen Geräten muss die
      App ggf. über "Zum Startbildschirm hinzufügen" installiert sein.
    </p>
  </section>
</template>

<style scoped>
.barcode {
  max-width: 36rem;
  margin: 0 auto;
}

.view-head {
  text-align: center;
  margin-bottom: 1rem;
}

.scanner-area {
  position: relative;
  aspect-ratio: 4/3;
  background: var(--bg-input);
  border-radius: var(--radius);
  overflow: hidden;
  margin-bottom: 1.5rem;
}

.scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner-placeholder,
.scanner-error,
.scanner-found {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 1rem;
}

.scanner-error {
  color: var(--danger);
}

.scanner-found {
  color: var(--success);
  background: rgba(0, 0, 0, 0.55);
}

.manual {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
  margin-bottom: 1rem;
}

.manual form {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.manual input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text);
}

.manual button {
  padding: 0.5rem 1rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.hint {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
}
</style>
