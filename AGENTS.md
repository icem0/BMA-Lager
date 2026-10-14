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

- **Images kommen aus GHCR.** `docker-compose.yml` referenziert `api`, `pwa` und `migrate` hartkodiert als `ghcr.io/icem0/bma-lager-{api,pwa}:latest`. **Kein** `build:`-Block, **kein** Variablen-Override. Deployer ziehen die Images — fertig.
- **`migrate`** ist ein Entry-Point des API-Images (`node dist/db/migrate.js`). Es wird also nicht für jeden Job ein eigenes Image gebaut. Den allerersten Admin legt die PWA selbst an, sobald `/api/auth/setup-status` meldet, dass die `users`-Tabelle leer ist.
- **CI-Workflow** `.github/workflows/build-and-push.yml` baut bei Push auf `main` (oder Tag `v*`) die Images und pusht sie mit Tag `:latest` **und** mit dem SHA-Tag. Bei Pull-Requests wird **nur** gebaut, nicht gepusht (Gate `if: github.event_name != 'pull_request'`). Sichtbarkeit wird per `PATCH /user/packages/container/{pkg}` auf `public` gesetzt.
- **GHCR-Token**: Für private Pakete braucht der Deployer einen GitHub-PAT mit Scope `read:packages`. Bare Docker / Coolify: `docker login ghcr.io`. Arcane: einmalig `POST /container-registries` mit dem PAT. Für öffentliche Pakete reicht kein Token.
- **Arcane / Coolify / bare Docker** funktionieren ohne Anpassung — sie alle ziehen `image:`-Referenzen transparent. Der frühere `build:`-Pfad ist absichtlich entfernt.
- **Update-Workflow**: `git pull && docker compose pull && docker compose up -d` (nicht `--build` — es gibt nichts Lokales zu bauen).
- **Lockfiles pro Paket**: `package-lock.json` im Root (PWA), `server/package-lock.json` (API). Beide müssen in ihrem jeweiligen Verzeichnis für `npm ci` liegen — beim CI-Build übernimmt das `working-directory` bzw. `cache-dependency-path`.
