# bma-lager – Implementierungsplan

Migration der bisherigen PowerApps-/SharePoint-Lösung zu einer **offline-fähigen PWA** auf Basis Vue 3 + Vite + Dexie (IndexedDB), ohne Backend.

> Verbindlich für jede Umsetzungsphase sind die Regeln in [`AGENTS.md`](./AGENTS.md):
> - Bestand = Summe unveränderlicher Buchungen (UUID + Zeitstempel)
> - TypeScript strict
> - `npm run lint` / `npm test` / `npm run build` müssen nach Änderungen grün sein
> - keine Secrets im Code

---

## 1. Ausgangslage (Ist-Stand PowerApps)

Zwei SharePoint-Listen:

- **`Lager`** – aktueller Bestand pro Artikel
  Felder: `ID, Foto, Title, Status, Type, Lieferant, VE, Bestand, Bestand-min, Nachbestellung, Bestellnr., Listenpreis, Geändert`
- **`Warenfluss`** – jede Bewegung als Zeile
  Felder: `Entnahme, Projekt-AA-SA-Nummer, Artikel, Menge, Erstellt, Erstellt-von, Entnommen aus, Artikel:ID, Artikel:Title, Kommentar, Mitteilung an`

Spalten `Entnahme` und `Entnommen aus` deuten auf Typ- und Standortinformation in der Buchungszeile hin.

## 2. Zielbild (Soll-Stand PWA)

| Aspekt | Wert |
|---|---|
| Architektur | PWA, offline-first, installierbar |
| Speicher | IndexedDB via Dexie (kein Backend) |
| Auth | keine (Ein-Benutzer-pro-PWA) |
| Bestand | `Σ buchungen.menge where storno=false` pro (Artikel, Standort) |
| Korrekturen | Storno-Buchung mit `stornoVon`-Verweis, niemals Original überschreiben |
| Kommission | echtes Storno + Neubuchung mit korrigiertem Projekt, Bestand bleibt konstant |
| Standorte | flach: `lager \| auto \| baustelle \| extern`, optional mit `projekt` |
| Sprachen | DE (Default) + EN, Sprachumschalter, `vue-i18n` |
| Build/Lint/Tests | `npm run build` / `lint` / `test` durchgehend grün |

---

## 3. Tech-Stack & Versionen

| Paket | Version | Zweck |
|---|---|---|
| `vue` | ^3.5 | UI |
| `vue-router` | ^4.5 | Navigation |
| `pinia` | ^2.3 | State, gespiegelt aus Dexie |
| `vue-i18n` | ^11 | i18n DE/EN |
| `dexie` | ^4 | IndexedDB-Wrapper |
| `papaparse` | ^5 | CSV-Parser für Import |
| `vite` | ^6 | Build/Dev |
| `@vitejs/plugin-vue` | ^6 | SFC-Compile |
| `vite-plugin-pwa` | ^0.21 | PWA-Shell, Service Worker, Manifest |
| `typescript` | ~5.9 | strict |
| `vue-tsc` | ^2.2 | Typecheck für SFCs |
| `eslint` | ^9 + `@vue/eslint-config-typescript` + `eslint-plugin-vue` | Lint |
| `prettier` | ^3.4 | Format |
| `vitest` | ^2.1 | Tests |
| `@vue/test-utils` | ^2.4 | Component-Tests (optional) |
| `fake-indexeddb` | ^6 | Dexie-Tests im Node-Runner |

> Anmerkung: Das mit `package.json` ausgelieferte Grundgerüst pinnte u. a. `typescript@~6.0.2`, `vue-tsc@^3.3.11`, `vue-i18n@^10.2.0`, `vite@^8.3.0` – das sind keine stabil verfügbaren Versionen (npm 404, peer-Konflikte). Wir gehen auf die oben gelisteten, aktuell stabilen Versionen zurück.

---

## 4. Datenmodell (Dexie v1)

Alle Tabellen haben `id: string` (UUID via `crypto.randomUUID()`), Zeitstempel als ISO-8601-UTC. Soft-Delete via `archiviert` (kein Hard-Delete in Domänen-Entitäten).

### 4.1 `artikel`
| Feld | Typ | Quelle | Hinweis |
|---|---|---|---|
| `id` | UUID | neu | **eigener** Schlüssel, SharePoint-`ID` separat |
| `sharePointId` | number \| null | `Lager.ID` | für Migration/Sync |
| `foto` | string \| null | `Lager.Foto` | URL/Pfad |
| `titel` | string | `Lager.Title` | |
| `status` | enum | `Lager.Status` | `verfuegbar \| reserviert \| gesperrt \| ausgesondert` |
| `typ` | string | `Lager.Type` | z. B. „Alarmierung" |
| `lieferant` | string \| null | `Lager.Lieferant` | |
| `verpackungseinheit` | number | `Lager.VE` | |
| `mindestbestand` | number \| null | `Lager.Bestand-min` | |
| `nachbestellHinweis` | enum | `Lager.Nachbestellung` | `i.O \| bald \| dringend \| null` |
| `bestellnummer` | string \| null | `Lager.Bestellnr.` | |
| `listenpreis` | number \| null | `Lager.Listenpreis` | |
| `geaendertAm` | ISO | `Lager.Geändert` | |
| `erstelltAm` | ISO | set-on-create | |
| `archiviert` | boolean | default `false` | |

Indizes: `id, sharePointId, typ, status, archiviert, titel`.

### 4.2 `standorte`
| Feld | Typ |
|---|---|
| `id` | UUID |
| `name` | string (eindeutig) |
| `typ` | `lager \| auto \| baustelle \| extern` |
| `projekt` | string \| null (für `auto`) |
| `kennzeichen` | string \| null (für `auto`) |
| `standard` | boolean (genau ein Hauptlager) |
| `archiviert` | boolean |

Indizes: `id, name, typ, archiviert`.

### 4.3 `buchungen` – das Herzstück, **append-only**
| Feld | Typ | Hinweis |
|---|---|---|
| `id` | UUID | unveränderlich |
| `artikelId` | UUID FK | |
| `standortId` | UUID FK | Quell- oder alleiniger Standort |
| `standortZielId` | UUID \| null | nur bei `umlagerung` |
| `typ` | enum | `einlagerung \| entnahme \| umlagerung \| inventur \| kommission \| storno` |
| `menge` | number (signed) | `inventur` ist **Differenz** (soll − ist) |
| `paarId` | UUID \| null | `umlagerung`: identische `paarId` auf `entnahme` + `einlagerung` |
| `projekt` | string \| null | `Projekt-AA-SA-Nummer` |
| `erstelltAm` | ISO | Buchungsdatum (zeitliche Reihenfolge) |
| `clientEingabeAm` | ISO | Erfassungszeitpunkt in der UI |
| `erstelltVon` | string | Anzeigename (keine Auth) |
| `kommentar` | string \| null | |
| `mitteilungAn` | string \| null | |
| `stornoVon` | UUID \| null | gesetzt auf `storno`-Buchungen |
| `storno` | boolean | schneller Filter |
| `storniertDurch` | UUID \| null | Back-Ref auf Storno-Buchung |

Indizes: `id, artikelId, standortId, standortZielId, typ, erstelltAm, storno, stornoVon, paarId`.

### 4.4 `projekte`
| Feld | Typ |
|---|---|
| `id` | UUID |
| `nummer` | string (z. B. `220405`) |
| `name` | string \| null |
| `archiviert` | boolean |

### 4.5 `einstellungen`
`key, value` (z. B. `sprache: 'de' | 'en'`, `standardStandortId`, `aktuellerBenutzer`).

### 4.6 `auditLog` – append-only
`id, aktion, entitaet, entitaetId, daten, zeit` – wird ausschließlich vom Service befüllt.

### Bestandsformel
```
bestand(artikelId, standortId)
  = Σ buchungen.menge
    WHERE storno = false
      AND (standortId = :s OR (typ='umlagerung' AND standortZielId = :s))
```
(`umlagerung` als „virtuelle Einlagerung" am Ziel – oder über `paarId` auflösen. Variante wird in Domain-Schicht entschieden, Begründung: `entnahme` an Quelle trägt negative Menge, `einlagerung` an Ziel trägt positive Menge, einfache Summe reicht.)

---

## 5. Domänenschicht (`src/domain/`)

Pure Functions, ohne UI-Abhängigkeit, vollständig unit-testbar. Dexie-Wrapper rufen sie auf, niemals umgekehrt.

### 5.1 Operationen
- `createEinlagerung({artikelId, standortId, menge, projekt?, erstelltVon, kommentar?, mitteilungAn?, erstelltAm?})` – validiert `menge > 0`
- `createEntnahme(...)` – validiert `menge > 0`; Soft-Warnung wenn `bestand < menge` (kein Hard-Lock, da Offline-DAU-Workflow)
- `createUmlagerung({artikelId, vonId, nachId, menge, ...})` – atomar: 2 Buchungen mit gleicher `paarId`
- `createKommission({buchungId, neuesProjekt, erstelltVon, kommentar?})` – Storno + Neubuchung mit neuem Projekt, **Bestand bleibt konstant**
- `createInventur({artikelId, standortId, sollMenge, erstelltVon, kommentar?})` – schreibt `inventur` mit `menge = soll − bestand`
- `stornieren({buchungId, grund, erstelltVon})` – 1 Storno-Buchung mit `stornoVon` und `menge = -original.menge`, setzt `storno=true` und `storniertDurch` am Original
- `getBestand({artikelId, standortId})` und `getBestandProStandort({artikelId})`

### 5.2 Invarianten (Tests verifizieren das)
- Storno einer bereits stornierten Buchung → `BereitsStorniertError`
- Umlagerung mit `vonId === nachId` → `GleicherStandortError`
- Inventur, wenn keine Buchungen existieren → schreibt `inventur` mit `menge = soll`
- Kommission immer 2 Buchungen mit `sum = 0` auf demselben Standort
- `Σ menge where storno=false` ergibt exakt den Bestand
- jede Schreiboperation läuft in einer Dexie-Transaktion (`rw: ['buchungen', 'artikel', 'auditLog']`)

### 5.3 Modulstruktur
```
src/domain/
  buchungen.ts          create*, stornieren
  bestand.ts            getBestand*, Listen
  validierung.ts        reine Validatoren
  errors.ts             BuchungsError-Hierarchie
  __tests__/            Vitest-Specs
  __fixtures__/         Test-Daten
```

---

## 6. Persistenz (`src/services/db.ts`)

Dexie-Klasse, exportiert eine einzige Singleton-Instanz `db`. Schema-Versionierung explizit:

```ts
db.version(1).stores({
  artikel:    'id, sharePointId, typ, status, archiviert, titel',
  standorte:  'id, name, typ, archiviert',
  buchungen:  'id, artikelId, standortId, standortZielId, typ, erstelltAm, storno, stornoVon, paarId',
  projekte:   'id, nummer, archiviert',
  einstellungen: 'key',
  auditLog:   'id, aktion, entitaet, entitaetId, zeit'
})
```

Reactive Queries via `liveQuery()` → fließen in Pinia-Stores.

---

## 7. Stores (`src/stores/`)

- `useArtikelStore` – Selektoren, Suche, CRUD
- `useBuchungStore` – CRUD über Domäne, Live-Bestände
- `useStandortStore` – Liste, Standard-Standort
- `useProjektStore`
- `useSettingsStore` – Locale, Benutzer, Default-Standort
- `useAuditStore`

Stores halten **keine** dauerhaften Spiegel, sondern konsumieren `liveQuery` und rufen Domänenfunktionen für Mutationen auf.

---

## 8. Routing (`src/router/`)

| Pfad | Komponente | Zweck |
|---|---|---|
| `/` | `DashboardView` | Bestand-Übersicht, „bald nachbestellen" |
| `/artikel` | `ArtikelListView` | Suche/Filter |
| `/artikel/neu` | `ArtikelFormView` | Neuanlage |
| `/artikel/:id` | `ArtikelDetailView` | Bestand je Standort, Historie, „Buchen" |
| `/buchungen` | `BuchungListView` | globale Buchungsliste |
| `/buchung/neu` | `BuchungFormView` | Maske (typ, artikel, standort, menge, …) |
| `/kommission/:buchungId` | `KommissionView` | Storno + Neubuchung mit Projektwahl |
| `/standorte` | `StandortListView` | Hauptlager + Autos verwalten |
| `/einstellungen` | `SettingsView` | Sprache, Benutzer, Export/Import |

---

## 9. i18n (`src/locales/`)

- `de-DE.json` (Default), `en-US.json`
- Schlüssel hierarchisch (`artikel.list.empty`, `buchung.form.submit`, …)
- Sprachumschalter in AppShell, persistiert in `einstellungen.sprache`
- Initial-Locale aus `einstellungen.sprache`, Fallback `de-DE`

---

## 10. PWA (`vite-plugin-pwa`)

- `registerType: 'autoUpdate'`
- Manifest: Name „BMA-Lager", `display: 'standalone'`, Icons (eigene Platzhalter, aus Vite-Logo wird eine monochrome Variante)
- Workbox-Strategie: App-Shell `precache`, Bilder `CacheFirst` mit Größenlimit
- Offline-Indikator in der AppShell

---

## 11. CSV-Import-Wizard (`src/services/import/`)

Voraussetzung: Du lieferst die vollständigen CSVs (oder Beispieldatensätze).

Flow:
1. **Datei wählen** → `papaparse` parst (Encoding, `;` vs `,`, Quotes)
2. **Vorschau** – erste 20 Zeilen, erkannte Spalten
3. **Mapping-UI** – SharePoint-Spalte → Dexie-Feld
4. **Validierung** – Pflichtfelder, Status/Type-Enum-Mapping, doppelte `sharePointId`
5. **Bestandsabgleich** – Vorschau-Vergleich `Lager.Bestand` gegen aus dem Warenfluss rekonstruierten Bestand; Konfliktliste zur Klärung
6. **Atomarer Import** in einer Dexie-Transaktion; bei Fehler vollständiger Rollback
7. **Ergebnis-Report** – importiert / übersprungen / Konflikte

Export analog als JSON (voll) und CSV (Buchungen je Standort) für Backup.

---

## 12. Tests (`vitest`)

Pflicht-Unit-Tests in `src/domain/__tests__/`:

- **Summen-Property** (Kernregel aus AGENTS.md): Beispieldatensätze, Bestand == Summe, alle Buchungstypen
- **Storno-Eindeutigkeit**: Original darf nicht zweimal storniert werden, Storno- und Original-Buchung koppeln sauber
- **Kommission**: genau 2 Buchungen, `Σ menge = 0` auf Standort, neues `projekt` sichtbar
- **Umlagerung**: genau 2 Buchungen, gleiche `paarId`, Quellbestand sinkt, Ziel steigt
- **Inventur**: `menge = soll − bestand`, danach Summe == Soll
- **Edge Cases**: Negativmengen, fehlende Pflichtfelder, unbekannte IDs → werfen definierte Errors
- **CSV-Parser** mit den mitgelieferten CSVs als Fixture

Test-Setup mit `fake-indexeddb`, damit Dexie unter Node läuft.

---

## 13. Sicherheit

- keine Secrets, keine Cloud-Calls, keine Telemetrie
- `Benutzername` ist ein freies Anzeigefeld für Buchungen, **keine** Authentifizierung
- `.env` bleibt in `.gitignore`; `.env.example` wird angelegt, falls Konfigurationsschlüssel nötig werden
- Vor jedem Commit: `git status`/`git diff` prüfen, keine Credentials

---

## 14. Reihenfolge der Umsetzung

1. **Tooling & Skripte** – ESLint, Prettier, Vitest, `lint`/`test`/`typecheck`-Skripte, `tsconfig` strict (`noUncheckedIndexedAccess`, `noImplicitOverride`)
2. **Dependencies** – vue-router, pinia, vue-i18n, dexie, vite-plugin-pwa, papaparse, fake-indexeddb
3. **Dexie-Schema** inkl. Migrations-Helfer
4. **Domänenschicht** (Buchungen, Storno, Kommission, Umlagerung, Inventur) + Unit-Tests **zuerst**, alles andere baut darauf auf
5. **PWA-Setup** (vite-plugin-pwa, Manifest, Icons)
6. **Stores + Router** (ohne UI)
7. **UI** in der Reihenfolge: AppShell → Dashboard → Artikel/Bestand → Buchungsmaske → Kommission/Storno/Inventur → Standorte → Einstellungen
8. **i18n** (DE/EN Texte)
9. **CSV-Import-Wizard** gegen deine realen CSVs
10. **Feinschliff**: README, Build/Lint/Tests komplett grün

---

## 15. Benötigte Eingaben vom Auftraggeber

- **Vollständige CSVs** `Lager.csv` und `Warenfluss.csv` (oder Beispieldatensätze, falls der Rest nicht herausgegeben werden soll)
- Optional: **Logo/Farbschema** für PWA-Icons, App-Farbe, Splash
- Optional: echte **Projekt-Stammdatenliste** (oder wachsen sie aus den Buchungen heraus?)

---

## 16. Offene Punkte / Risiken

- **Versions-Konflikt TypeScript**: das mitgelieferte Grundgerüst pinnte nicht-existente Versionen. Wir gehen auf stabile Releases zurück; bei späterer Migration auf TS 6 / vue-tsc 3 erneut prüfen.
- **Datenverlust bei Migration**: kein automatischer Sync zurück nach SharePoint geplant; Export als JSON-Backup ist Pflicht.
- **Mehrbenutzer-Fall**: aktuell nicht vorgesehen. Bei Bedarf Konfliktauflösung offline-only sehr komplex – das wäre ein eigenes Feature (späterer Sync).

---

## 17. Aktueller Bearbeitungsstand

> Stand beim Erstellen dieses Dokuments.

| Schritt | Status | Notiz |
|---|---|---|
| Plan | ✅ fertig | dieses Dokument |
| Schritt 1 (Tooling/Skripte) | ✅ fertig | ESLint-Flat, Prettier, Vitest, `tsconfig` strict (`noUncheckedIndexedAccess`, `noImplicitOverride`), Skripte (`lint`, `lint:fix`, `format`, `test`, `test:run`, `typecheck`, `build`) |
| Schritt 2 (Dependencies) | ✅ fertig | stable Releases; nach Audit-Major-Sprung: `vitest@5`, `@vitest/coverage-v8@5`, `eslint-plugin-vue@10`. `vue-i18n` v11, `vue-tsc` v2.2, `vite` v6, `typescript` ~5.9. |
| Schritt 3 (Dexie-Schema) | ✅ fertig | `BmaLagerDb` mit `version(1).stores(...)`, Singleton-Getter, Test-Reset-Helfer |
| Schritt 4 (Domain + Tests) | ✅ fertig | `createEinlagerung/Entnahme/Umlagerung/Kommission/Inventur`, `stornieren`, `berechneBestand*`; 16 Unit-Tests (Vitest 5 + `fake-indexeddb`) |
| Schritt 5 (PWA) | ✅ fertig | `vite-plugin-pwa` mit `autoUpdate`, Manifest, Workbox (precache, CacheFirst für Bilder 60/30d, Navigation-Fallback), SVG-Icon, Offline-Indikator in AppShell |
| Schritt 6 (Stores/Router) | ✅ fertig | Pinia-Stores (`artikel`, `standort`, `buchung`, `projekt`, `settings`, `audit`) mit `liveQuery`; vue-Router mit 8 Pfaden + Catch-all |
| Schritt 7 (i18n + UI) | ✅ fertig | vue-i18n v11 (de-DE, en-US), typsichere Schlüssel; 9 Views (Dashboard, Artikel-Liste/-Form/-Detail, Buchungs-Liste/-Form, Kommission, Standorte, Settings) + Offline-Banner in AppShell |
| Schritt 8 (CSV-Import) | ✅ fertig | Wizard (`ImportView`), Parser, Mapping-Heuristik, Validierung, atomarer Import, JSON-Backup; 9 zusätzliche Tests (gesamt 25) |
| Final (lint/test/build) | ✅ grün | `lint`: 0 errors/0 warnings, `typecheck`: 0 errors, `test:run`: 25/25, `build`: grün, PWA-SW generiert |

### Verbleibende Audit-Vulnerabilities

`npm audit` zeigt nach den Major-Sprüngen **4 high** (`brace` Stack-DoS, transitiv über `braces`/`micromatch`/`fast-glob` in `@vue/eslint-config-typescript`). Es gibt **keine** critical-RCE-Funde mehr (tinypool-RCE wurde durch `vitest@5` behoben). Die verbleibenden Funde sind rein im Lint-Dev-Stack und nicht in der App-Laufzeit erreichbar. Fix nur durch Major-Sprung auf eine zukünftige `@vue/eslint-config-typescript`-Version.

### Bereits durchgeführte Änderungen am Repo

- `package.json` – Skripte ergänzt, Dependencies aktualisiert, `name` → `bma-lager`, `version` → `0.1.0`
- Tooling-Konfigs: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `vitest.setup.ts` (`fake-indexeddb/auto`)
- `tsconfig.app.json` – strict + `noUncheckedIndexedAccess` + `noImplicitOverride`
- `vite.config.ts` – `VitePWA` mit Manifest + Workbox
- `public/pwa-icon.svg`, `index.html` mit `theme-color`/Apple-Touch
- `src/db/{database,types}.ts` – Dexie v1-Schema, Singleton-Getter
- `src/domain/{buchungen,bestand,errors,ids,validierung}.ts` – Domain-Operationen + Errors-Hierarchie
- `src/services/import/{csv-parser,mapping,validierung,import,export}.ts` – CSV-Import-Pipeline + JSON-Backup
- `src/stores/{artikel,standort,buchung,projekt,settings,audit}.ts` – Pinia-Stores mit `liveQuery`
- `src/router/index.ts` – 8 Routen + Catch-all
- `src/views/*.vue` – DashboardView, ArtikelListView, ArtikelFormView, ArtikelDetailView, BuchungListView, BuchungFormView, KommissionView, StandortListView, SettingsView, ImportView
- `src/locales/{de-DE,en-US}.ts`, `src/locales/i18n.d.ts` – Übersetzungen + typ-sichere Schlüssel
- `src/{App.vue,main.ts,i18n.ts,vite-env.d.ts}` – App-Shell + PWA-Registrierung + i18n + Types
- Tests: `src/__tests__/smoke.test.ts`, `src/domain/__tests__/buchungen.test.ts` (16), `src/services/import/__tests__/import.test.ts` (9)

**Diese Änderungen sind committed noch nicht** (lt. AGENTS.md-Regel „nur auf explizite Aufforderung committen").
