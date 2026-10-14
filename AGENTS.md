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

## Build & Deployment

- **Default-Workflow ist Self-Host-Build.** `docker-compose.yml` definiert für `api`, `pwa`, `migrate` und `bootstrap` jeweils `build:`-Direktiven (statt `image:`). `docker compose up -d` baut diese Images beim ersten Start automatisch **lokal** aus den mitgelieferten Dockerfiles. Kein vorheriger `docker pull`, kein Registry-Login, keine GHCR-Credentials nötig.
- **Arcane / Coolify / bare Docker**: funktioniert ohne Anpassung. Arcane z. B. triggert den Build über seinen `POST /projects/{id}/build`-Endpoint — die `build:`-Direktive greift dort direkt. Coolify erkennt `build:` ebenfalls nativ.
- **GHCR-Production-Pfad bleibt erhalten.** Der CI-Workflow `.github/workflows/build-and-push.yml` pusht weiterhin bei jedem `main`-Push Images nach `ghcr.io/icem0/bma-lager-{api,pwa}`. Wer für Production vorgebaute Images nutzen will, kann sie dort abholen — der `docker-compose.yml`-Default wird dadurch **nicht** gebrochen.
- **Update-Workflow**: `git pull && docker compose up -d --build` (nicht `docker compose pull` — es gibt keine externen Images mehr).
- **Lockfiles pro Paket**: `package-lock.json` im Root (PWA), `server/package-lock.json` (API). Beide müssen in ihrem jeweiligen Verzeichnis für `npm ci` liegen — beim Dockerfile-Build übernimmt das `COPY package.json package-lock.json* ./` im jeweiligen Stage.
- **Dockerfile-Pfade in `build:`**: bei Subdir-Dockerfiles `context: ./server, dockerfile: Dockerfile` verwenden — **nicht** `dockerfile: ./server/Dockerfile`, das schlägt fehl.
