#!/usr/bin/env bash
# concurrency_repro.sh — reproduces the UPSTREAM concurrent-HTTP-response
# corruption (a cyrius/sandhi core thread-safety bug, NOT a probe bug).
#
# Under high concurrent load (~300 simultaneous requests), cyrius/sandhi corrupt
# ~3% of HTTP responses with cross-field byte interleaving — e.g. the /api/health
# body `{"status":"ok","service":"yeo-cy-test","version":"0.1.0"}` comes back as
# `{"ctatye":"-t","servire":"yeo.c1.0est",...}` (bytes of "yeo-cy-test" and
# "0.1.0" spliced together). This is INDEPENDENT of patra: /api/health touches no
# DB, no route params, and no app lock — it just builds a tiny static JSON via
# the probe's resp_json (json_v_build → str_builder) and sandhi's
# sandhi_server_send_response_c. Every layer (alloc/default_alloc, str_builder,
# json_v) is individually per-call and bottoms out at the CAS-locked alloc(), yet
# concurrent responses share overlapping memory — so the race is in the cyrius
# core alloc/build path under contention. It makes the probe's concurrency
# scenarios (verify.py 4/8/10) intermittently flaky.
#
# Filed upstream (cyrius/sandhi). This script is a diagnostic, NOT a pass/fail
# gate — it is EXPECTED to show corruption until the upstream bug is fixed.
#
# Usage:  ./build.sh && tests/concurrency_repro.sh   (server auto-started)
set -uo pipefail
cd "$(dirname "$0")/.."

EXP='{"status":"ok","service":"yeo-cy-test","version":"0.1.0"}'
N="${1:-300}"
BIN=./build/yeo-cy-test
[ -x "$BIN" ] || { echo "build first: ./build.sh"; exit 2; }

rm -f yeo.patra
"$BIN" >/dev/null 2>&1 &
SRV=$!
# wait for :8080
for _ in $(seq 1 50); do
  if (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null; then exec 3>&- 3<&-; break; fi
  sleep 0.1
done

TMP="$(mktemp -d)"
for i in $(seq 1 "$N"); do
  curl -s -m5 http://127.0.0.1:8080/api/health -o "$TMP/$i.txt" &
done
wait

bad=0
for f in "$TMP"/*.txt; do
  [ "$(cat "$f")" = "$EXP" ] || { bad=$((bad+1)); echo "  CORRUPT: $(cat "$f")"; }
done
echo "concurrent /api/health: $bad / $N corrupt (~$(( bad * 100 / N ))%)"

kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
rm -rf "$TMP" yeo.patra
# Always exit 0 — this documents a known upstream bug, it is not a gate.
exit 0
