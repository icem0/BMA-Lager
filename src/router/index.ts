// Router-Konfiguration gemäß PLAN §8.
// Die Views sind aktuell Platzhalter; volle UI folgt in Schritt 7.

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import ArtikelListView from '../views/ArtikelListView.vue'
import ArtikelFormView from '../views/ArtikelFormView.vue'
import ArtikelDetailView from '../views/ArtikelDetailView.vue'
import BuchungListView from '../views/BuchungListView.vue'
import BuchungFormView from '../views/BuchungFormView.vue'
import KommissionView from '../views/KommissionView.vue'
import StandortListView from '../views/StandortListView.vue'
import SettingsView from '../views/SettingsView.vue'
import ImportView from '../views/ImportView.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'dashboard', component: DashboardView },
  { path: '/artikel', name: 'artikel', component: ArtikelListView },
  { path: '/artikel/neu', name: 'artikel-neu', component: ArtikelFormView },
  {
    path: '/artikel/:id',
    name: 'artikel-detail',
    component: ArtikelDetailView,
    props: true,
  },
  { path: '/buchungen', name: 'buchungen', component: BuchungListView },
  { path: '/buchung/neu', name: 'buchung-neu', component: BuchungFormView },
  {
    path: '/kommission/:buchungId',
    name: 'kommission',
    component: KommissionView,
    props: true,
  },
  { path: '/standorte', name: 'standorte', component: StandortListView },
  { path: '/einstellungen', name: 'einstellungen', component: SettingsView },
  { path: '/import', name: 'import', component: ImportView },
  // Catch-all: auf Dashboard zurückfallen, damit die App nie "leer" ist.
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
