#!/usr/bin/env bash
# One-command verification of the whole slice:
#   build (frontend emit + backend) → unit invariants → backend e2e → UI e2e.
# Run from anywhere:  tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

./build.sh

echo "▸ unit invariants (cyrius run src/test.cyr)…"
cyrius run src/test.cyr

echo "▸ backend e2e — 43 scenarios (tests/verify.py)…"
python3 tests/verify.py

echo "▸ full-stack UI e2e — 10 scenarios (tests/ui_check.mjs)…"
node tests/ui_check.mjs

rm -f yeo.patra yeo-test.patra yeo-audit.patra yeo-auth.key yeo-identity.key
echo "✓ all suites passed (unit + 43 backend + 10 full-stack UI)"
