#!/bin/sh
# Entrypoint fuer den PWA-Container (nginx).
#
# Erzeugt beim Container-Start /usr/share/nginx/html/config.js aus der
# ENV-Variable VITE_API_URL. Die PWA laedt /config.js vor dem App-Bundle
# und liest daraus window.__BMA_API_URL__ (siehe src/auth/api.ts).
#
# ENV-Variablen:
#   VITE_API_URL  Basis-URL des API-Backends (z. B. http://api.example.com:4242)
#                 Default: http://localhost:4242

set -eu

VITE_API_URL="${VITE_API_URL:-http://localhost:4242}"

# JS-String-Escapung: Backslashes und Anfuehrungszeichen.
# Fuer typische URLs (http(s)://host[:port]) ausreichend.
escaped=$(printf '%s' "$VITE_API_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/config.js <<EOF
// AUTO-GENERATED at container start from \$VITE_API_URL. Do not edit.
window.__BMA_API_URL__ = "${escaped}";
EOF

exec "$@"
