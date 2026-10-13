import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { i18n, type AppLocale } from './i18n'
import { useSettingsStore, type Sprache } from './stores/settings'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(i18n)
app.mount('#app')

// Locale aus Settings-Store nachziehen. Da die Settings-Store-Werte
// asynchron via Dexie liveQuery geladen werden, setzen wir einen Watcher,
// der die i18n-Locale spiegelt.
const settings = useSettingsStore()
settings.start()
watch(
  () => settings.settings.sprache,
  (sprache: Sprache) => {
    const next: AppLocale = sprache === 'en' ? 'en-US' : 'de-DE'
    if (i18n.global.locale.value !== next) {
      i18n.global.locale.value = next
    }
  },
  { immediate: true },
)

// PWA-Service-Worker registrieren.
// `autoUpdate` (vite.config.ts) sorgt dafür, dass ein neuer SW bei nächstem
// Seitenaufruf aktiviert wird; bei Bedarf kann hier auf 'prompt' umgeschaltet
// werden, um den Nutzer zu fragen.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({ immediate: true })
    })
    .catch((e) => {
      // Kein Hard-Fail – App funktioniert auch ohne SW, nur ohne Offline-Cache.

      console.warn('Service-Worker-Registrierung fehlgeschlagen:', e)
    })
}
