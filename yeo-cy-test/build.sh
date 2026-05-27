#!/usr/bin/env bash
# yeo-cy-test build — cyrius is the only toolchain touched.
#
#   1. Validate the frontend TS/TSX with cyrius   (cycc --parse-ts)
#   2. Build the Cyrius backend                    (cyrius build)
#
# There is no TS->JS emit in Cyrius yet (see FINDINGS.md), so the deployable
# browser bundle (web/app.js) is authored by hand from web/app.tsx. Once an
# emit stage lands, step 1 becomes a real compile and app.js is generated.
set -euo pipefail
cd "$(dirname "$0")"

CYCC="${CYCC:-cycc}"

echo "▸ Validating frontend TS/TSX with cyrius (cycc --parse-ts)…"
shopt -s nullglob
for f in web/*.tsx web/*.ts; do
  # </dev/null: cycc --parse-ts blocks on stdin even with a file arg (FINDINGS.md).
  if "$CYCC" --parse-ts "$f" </dev/null >/dev/null 2>&1; then
    echo "  ✓ $f"
  else
    echo "  ✗ $f failed to parse" >&2
    exit 1
  fi
done

echo "▸ Building Cyrius backend (cyrius build)…"
cyrius build src/main.cyr build/yeo-cy-test

echo "✓ build complete → build/yeo-cy-test"
echo "  run:  ./build/yeo-cy-test   then open http://localhost:8080/"
