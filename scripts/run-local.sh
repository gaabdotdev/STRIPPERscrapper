#!/usr/bin/env bash
# Atalho opcional: npm ci + npm start (pipeline completa vive no main.js).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    -h | --help)
      cat <<'EOF'
Uso: scripts/run-local.sh [opções] [--] [flags do main.js]

  Atalho: npm ci (opcional) + npm start com os mesmos argumentos.

  A pipeline completa (captcha → scrape → extrair ZIPs) corre em main.js.
  Exemplo principal:

    npm start -- --all --workers 10

  Com este script (+ instala deps):

    npm run run:local -- --all --workers 10
    npm run run:local -- --skip-install --all --workers 10

Opções do script:
  --skip-install   Não corre npm ci
EOF
      exit 0
      ;;
  esac
done

FORWARD=()
for arg in "$@"; do
  if [ "$arg" = "--skip-install" ]; then
    continue
  fi
  FORWARD+=("$arg")
done

if [ "$SKIP_INSTALL" -eq 0 ]; then
  echo "=== npm ci ==="
  PUPPETEER_SKIP_DOWNLOAD=true npm ci
fi

echo ""
echo "=== npm start -- ${FORWARD[*]:-<flags>} ==="
exec npm start -- "${FORWARD[@]}"
