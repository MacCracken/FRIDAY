#!/usr/bin/env bash
# yeo-cy-test build — cyrius is the only toolchain touched.
#
#   1. Build the frontend: TS/TSX -> browser JS   (cyrius build --target=js)
#   2. Build the Cyrius backend                    (cyrius build)
#
# As of cyrius 6.1.11+ the TS/TSX -> JS emitter exists, so web/app.js is now a
# GENERATED artifact (was hand-lowered on 6.0.3 when there was no emit — see
# FINDINGS.md). web/app.tsx is the single source of truth; do not hand-edit
# web/app.js. The emit also validates the source (it parses + walks the AST),
# so the old `cycc --parse-ts` validate-only step is subsumed.
set -euo pipefail
cd "$(dirname "$0")"

# The server serves HTTPS (:8443) and needs an Ed25519 cert+key. Mint them if
# absent so a clean checkout's build→run flow just works (they're gitignored).
if [ ! -f cert.pem ] || [ ! -f key.pem ]; then
  echo "▸ Minting TLS cert (cert.pem/key.pem)…"
  ./gen-certs.sh
fi

echo "▸ Building frontend (cyrius build --target=js)…"
shopt -s nullglob
for f in web/*.tsx; do
  out="web/$(basename "${f%.tsx}").js"
  if cyrius build --target=js "$f" "$out" </dev/null; then
    node --check "$out" 2>/dev/null && echo "  ✓ $f → $out (node --check OK)"
  else
    echo "  ✗ $f failed to emit" >&2
    exit 1
  fi
done

echo "▸ Building Cyrius backend (cyrius build)…"
cyrius build src/main.cyr build/yeo-cy-test

echo "✓ build complete → build/yeo-cy-test"
echo "  run:  ./build/yeo-cy-test   then open http://localhost:8080/"
