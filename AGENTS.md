# AGENTS

Regeln für alle Coding-Agents und Entwickler, die an diesem Projekt arbeiten.

## Architektur

- **Web-App / PWA** – läuft im Browser, installierbar, offline-fähig.
- **Offline-first** – die App funktioniert ohne Netzverbindung. Synchronisation, falls später nötig, ist explizit als Feature zu planen.
- **Lokale Datenbank im Browser** – alle Daten werden lokal persistiert (IndexedDB via Dexie o. ä.). Kein Backend erforderlich.

## Datenmodell

- **Bestand ist die Summe von Buchungen.** Es gibt keine überschreibenden Mengenupdates.
- Jede Buchung hat eine **UUID** (kein auto-increment, keine laufende Nummer) und einen Zeitstempel.
- Buchungen sind unveränderlich. Korrekturen erfolgen durch Storno- oder Gegenbuchungen.

## Code-Qualität

- **TypeScript** – kein ungetypter Code in neu geschriebenen Dateien.
- **Nach Änderungen** sind Lint und Tests auszuführen:
  - `npm run lint`
  - `npm test`
- Build muss sauber durchlaufen: `npm run build`.

## Sicherheit

- **Keine Secrets im Code.** API-Keys, Tokens, Passwörter und private Konfiguration gehören in `.env` (nicht eingecheckt) oder werden zur Laufzeit vom Benutzer eingegeben.
- Vor jedem Commit ist zu prüfen, dass keine Credentials versehentlich committet wurden.
