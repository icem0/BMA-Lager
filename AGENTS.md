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

## Build-Metadaten in der PWA

`scripts/write-version.mjs` läuft vor jedem Build und schreibt `src/version.ts`
(Version aus `package.json`, Commit/Branch/Build-Datum). Im PWA-Buildx gibt es
kein `.git/`, also fallen Commit/Branch sonst auf `unbekannt` zurück. Das CI
reicht deshalb `GIT_COMMIT` (`github.sha`) und `GIT_BRANCH` (`github.ref_name`)
als Build-Args an `Dockerfile.pwa` durch — `write-version.mjs` liest sie aus
der ENV und nutzt sie mit Fallback auf `git rev-parse` (lokal).

## Code-Qualität

- **TypeScript** – kein ungetypter Code in neu geschriebenen Dateien.
- **Nach Änderungen** sind Lint und Tests auszuführen:
  - `npm run lint`
  - `npm test`
- Build muss sauber durchlaufen: `npm run build`.

## Commits & Versionierung

- **Conventional Commits sind Pflicht.** Commit-Messages folgen dem Format
  `<type>(<scope>)?: <subject>` (siehe `commitlint.config.mjs`). Husky
  blockiert nicht-konforme Messages lokal (`commit-msg`-Hook).
- **Erlaubte Typen**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`,
  `test`, `build`, `ci`, `chore`, `revert`. `feat!`/`BREAKING CHANGE:` für
  Major-Bumps.
- **release-please** (`.github/workflows/release-please.yml`) öffnet bei
  jedem Push auf `main` einen Release-PR, der `package.json` + `CHANGELOG.md`
  bumpt und das passende `vX.Y.Z`-Tag erzeugt. Konfig in
  `.release-please-config.json` (Single-Package-Repo — `manifest-file` ist
  nicht gesetzt, sonst crash mit `versionString.match is not a function`).
  - Vor `1.0.0`: `feat` → minor, `fix` → patch (`bump-minor-pre-major`).
  - Ab `1.0.0`: Semver strikt (`feat` → minor, `fix` → patch, Breaking → major).
- **`build-and-push.yml`** baut das PWA- und API-Image bei Push auf `main`
  **und** bei Tag `v*` — der `v*`-Trigger sorgt dafür, dass auch nach
  Release-PRs ein frisches Image mit der neuen Version gepusht wird.

## Sicherheit

- **Keine Secrets im Code.** API-Keys, Tokens, Passwörter und private Konfiguration gehören in `.env` (nicht eingecheckt) oder werden zur Laufzeit vom Benutzer eingegeben.
- Vor jedem Commit ist zu prüfen, dass keine Credentials versehentlich committet wurden.

## Build & Deployment

- **Images kommen aus GHCR.** `docker-compose.yml` referenziert `api`, `pwa` und `migrate` hartkodiert als `ghcr.io/icem0/bma-lager-{api,pwa}:latest`. **Kein** `build:`-Block, **kein** Variablen-Override. Deployer ziehen die Images — fertig.
- **`migrate`** ist ein Entry-Point des API-Images (`node dist/db/migrate.js`). Es wird also nicht für jeden Job ein eigenes Image gebaut. Die `api`-Service-Definition startet vor jedem Server-Start automatisch `node dist/db/migrate.js` (idempotent — bereits angewendete Migrationen werden uebersprungen). Den allerersten Admin legt die PWA selbst an, sobald `/api/auth/setup-status` meldet, dass die `users`-Tabelle leer ist. Der `migrate`-Profil-Service bleibt fuer manuelle Aufrufe erhalten (`docker compose --profile migrate run --rm migrate`).
- **CI-Workflow** `.github/workflows/build-and-push.yml` baut bei Push auf `main` (oder Tag `v*`) die Images und pusht sie mit Tag `:latest` **und** mit dem SHA-Tag. Bei Pull-Requests wird **nur** gebaut, nicht gepusht (Gate `if: github.event_name != 'pull_request'`). Sichtbarkeit wird per `PATCH /user/packages/container/{pkg}` auf `public` gesetzt.
- **GHCR-Token**: Für private Pakete braucht der Deployer einen GitHub-PAT mit Scope `read:packages`. Bare Docker / Coolify: `docker login ghcr.io`. Arcane: einmalig `POST /container-registries` mit dem PAT. Für öffentliche Pakete reicht kein Token.
- **GHCR-Visibility-Automation**: `build-and-push.yml` ruft am Ende jedes Jobs `PATCH /user/packages/container/{pkg}` mit `{"visibility":"public"}`. Der automatische `GITHUB_TOKEN` darf das für User-Repos **nicht** (gibt 404). Lösung: klassischen PAT mit Scopes `repo` + `write:packages` unter dem Secret-Namen **`GHCR_ADMIN_TOKEN`** im Repo hinterlegen (`Settings → Secrets and variables → Actions`). Ohne Secret wird der Flip mit `::warning::` übersprungen — das Image wird trotzdem gepusht, das Paket bleibt aber `private`. Für server-seitige Pulls reicht das (Auth gegen `ghcr.io` via `docker login` bzw. Coolify-/Arcane-Registry-Config). Wer das Paket wirklich öffentlich haben will, legt den Secret an, der Flip läuft dann automatisch.
- **Arcane / Coolify / bare Docker** funktionieren ohne Anpassung — sie alle ziehen `image:`-Referenzen transparent. Der frühere `build:`-Pfad ist absichtlich entfernt.
- **Update-Workflow**: `git pull && docker compose pull && docker compose up -d` (nicht `--build` — es gibt nichts Lokales zu bauen).
- **Lockfiles pro Paket**: `package-lock.json` im Root (PWA), `server/package-lock.json` (API). Beide müssen in ihrem jeweiligen Verzeichnis für `npm ci` liegen — beim CI-Build übernimmt das `working-directory` bzw. `cache-dependency-path`.
