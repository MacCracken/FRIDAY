#!/usr/bin/env bash
# One-command verification of the whole slice:
#   build (frontend emit + backend) → unit invariants → backend e2e → UI e2e.
# Run from anywhere:  tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

./build.sh

echo "▸ unit invariants — 9 (cyrius run src/test.cyr)…"
cyrius run src/test.cyr

echo "▸ backend e2e — 46 scenarios (tests/verify.py)…"
python3 tests/verify.py

echo "▸ full-stack UI e2e — 13 scenarios (tests/ui_check.mjs)…"
node tests/ui_check.mjs

rm -f yeo.patra yeo-test.patra yeo-audit.patra yeo-auth.key yeo-identity.key
echo "✓ all suites passed (9 unit + 46 backend + 13 full-stack UI)"
