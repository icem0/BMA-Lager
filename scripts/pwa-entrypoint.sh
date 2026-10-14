#!/bin/sh
# Entrypoint fuer den PWA-Container (nginx).
#
# Erzeugt beim Container-Start /usr/share/nginx/html/config.js aus der
# ENV-Variable VITE_API_URL. Die PWA laedt /config.js vor dem App-Bundle
# und liest daraus window.__BMA_API_URL__ (siehe src/auth/api.ts).
#
# ENV-Variablen:
#   VITE_API_URL  Basis-URL des API-Backends.
#                 Leer oder ungesetzt -> window.__BMA_API_URL__ = ''  (gleicher
#                 Origin, nginx proxied /api/* an die API).
#                 Sonst -> absolute URL, z. B. http://api.example.com:4242.

set -eu

VITE_API_URL="${VITE_API_URL-}"

# JS-String-Escapung: Backslashes und Anfuehrungszeichen.
escaped=$(printf '%s' "$VITE_API_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/config.js <<EOF
// AUTO-GENERATED at container start from \$VITE_API_URL. Do not edit.
window.__BMA_API_URL__ = "${escaped}";
EOF

# Hinweis: VITE_API_URL ist die Origin-Basis. Die App haengt '/api/...'
# selbst an. Ein trailing '/api' fuehrt sonst zu '/api/api/...' und 404.
# src/auth/api.ts entfernt ein trailing '/api' automatisch, aber sauberer
# ist die Origin-Basis ohne '/api'-Suffix.
case "$escaped" in
  */api)
    printf '[pwa-entrypoint] WARN: VITE_API_URL ends with /api — auto-trimmed at runtime. Set the origin instead (e.g. https://example.com).\n' >&2
    ;;
esac

exec "$@"
