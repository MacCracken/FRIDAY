#!/usr/bin/env bash
# build-binary.sh — Bun compile pipeline for SecureYeoman single-binary distribution
#
# Usage:
#   VERSION=2026.3.18 bash scripts/build-binary.sh           # full production build (all platforms)
#   VERSION=2026.3.18 bash scripts/build-binary.sh --dev     # dev build: current platform only, skip Tier 2/3 + checksums
#   VERSION=2026.3.18 bash scripts/build-binary.sh --edge    # edge build only: minimal A2A runtime
#   VERSION=2026.3.18 bash scripts/build-binary.sh --agent   # agent build only: soul + AI agent runtime
#
# Binary naming: secureyeoman-$DATE-$TYPE-$PLATFORM (CalVer YYYYMMDD or YYYYMMDDN for patches)
#   e.g. VERSION=2026.3.18   → secureyeoman-20260318-linux-x64
#        VERSION=2026.3.18-1 → secureyeoman-202603181-linux-x64
#
# Produces:
#   Tier 1 (needs PostgreSQL): secureyeoman-$DATE-linux-x64, -linux-arm64, -darwin-arm64, -windows-x64.exe
#   Tier 2 (SQLite-only):      secureyeoman-$DATE-sqlite-linux-x64, -sqlite-linux-arm64, -sqlite-windows-x64.exe
#   Tier 2.5 (Agent, soul+AI): secureyeoman-$DATE-agent-linux-x64, -agent-linux-arm64, -agent-darwin-arm64
#   Tier 3 (Edge/IoT):         secureyeoman-$DATE-edge-linux-x64 (Rust sy-edge, native only)
#
# Prerequisites: bun >= 1.1, npm (for TypeScript build step)
#
# SQL migration files are shipped in dist/migrations/ co-located with each binary.
# In the compiled binary, import.meta.url resolves to the virtual FS root (/$bunfs/),
# so readFileSync uses dirname(process.execPath)/migrations/ at runtime.
# The Dockerfile copies dist/migrations/ to /usr/local/bin/migrations/.
#
# NOTE: The --assets flag (for embedding dashboard dist into the binary) requires
# Bun >= 1.2. With Bun 1.x < 1.2 the flag is unrecognised and the dashboard dist
# must be supplied via SECUREYEOMAN_DASHBOARD_DIST or placed at the conventional
# location /usr/share/secureyeoman/dashboard. The build step is retained as a
# comment below — re-enable once a compatible Bun version is available.

set -euo pipefail

# ── Resolve bun ──────────────────────────────────────────────────────────────
# Look for bun in the conventional install locations before falling back to PATH.
for BUN_CANDIDATE in \
    "${HOME}/.bun/bin/bun" \
    "${HOME}/.local/bin/bun" \
    "/usr/local/bin/bun" \
    "/opt/homebrew/bin/bun"; do
  if [[ -x "${BUN_CANDIDATE}" ]]; then
    export PATH="$(dirname "${BUN_CANDIDATE}"):${PATH}"
    break
  fi
done

if ! command -v bun &>/dev/null; then
  echo "error: bun not found. Install it from https://bun.sh and retry." >&2
  exit 1
fi
echo "==> Using $(bun --version) at $(command -v bun)"

# ── Parse flags ───────────────────────────────────────────────────────────────
DEV_MODE=false
EDGE_ONLY=false
AGENT_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --dev) DEV_MODE=true ;;
    --edge) EDGE_ONLY=true ;;
    --agent) AGENT_ONLY=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# ── CalVer → compact date tag ─────────────────────────────────────────────────
# Transforms YYYY.M.D → YYYYMMDD, YYYY.M.D-N → YYYYMMDDN (zero-padded month/day).
# Used for binary filenames: secureyeoman-$DATE_TAG-$TYPE-$PLATFORM
calver_to_compact() {
  local ver="$1"
  local base="${ver%%-*}"           # strip patch suffix if present
  local patch=""
  [[ "$ver" == *-* ]] && patch="${ver##*-}"

  local year="${base%%.*}"
  local rest="${base#*.}"
  local month="${rest%%.*}"
  local day="${rest#*.}"

  printf '%s%02d%02d%s' "$year" "$month" "$day" "$patch"
}

# VERSION env var is required for release builds, falls back to VERSION file for dev.
if [[ -z "${VERSION:-}" ]]; then
  VERSION_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/VERSION"
  if [[ -f "${VERSION_FILE}" ]]; then
    VERSION="$(cat "${VERSION_FILE}" | tr -d '[:space:]')"
  else
    echo "error: VERSION env var not set and VERSION file not found." >&2
    exit 1
  fi
fi
DATE_TAG="$(calver_to_compact "${VERSION}")"
echo "==> Version: ${VERSION} → binary date tag: ${DATE_TAG}"

# ── Detect current platform for --dev mode ───────────────────────────────────
if [[ "$DEV_MODE" == true ]]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)   DEV_TARGET="bun-linux-x64"   ;;
    Linux-aarch64)  DEV_TARGET="bun-linux-arm64"  ;;
    Darwin-arm64)   DEV_TARGET="bun-darwin-arm64" ;;
    Darwin-x86_64)  DEV_TARGET="bun-darwin-x64"   ;;
    *) echo "error: --dev mode unsupported on $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
  echo "==> Dev mode: building for current platform only (${DEV_TARGET#bun-})"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REPO_ROOT}/dist"

# ── TypeScript build ──────────────────────────────────────────────────────────
echo "==> Building TypeScript..."
(cd "${REPO_ROOT}" && npm run build)

# ── Dashboard build ───────────────────────────────────────────────────────────
if [[ "$DEV_MODE" == false ]]; then
  echo "==> Building dashboard..."
  (cd "${REPO_ROOT}/packages/dashboard" && npm run build 2>/dev/null || true)
fi

mkdir -p "${DIST_DIR}"

echo "==> Copying SQL migration files to dist/migrations/..."
mkdir -p "${DIST_DIR}/migrations"
cp "${REPO_ROOT}/packages/core/src/storage/migrations"/*.sql "${DIST_DIR}/migrations/"

# ── Shared compile flags ──────────────────────────────────────────────────────
BUN_EXTERNAL=(
  --external "playwright"
  --external "playwright-core"
  --external "electron"
  --external "chromium-bidi"
  --external "node-saml"
  --external "canvas"
  --external "kokoro-js"
  --external "better-sqlite3"
)

compile_binary() {
  local TARGET="$1"
  local OUTFILE="$2"
  # --assets embeds the dashboard dist into the binary's virtual FS (requires Bun >= 1.2).
  # Remove the comment prefix below once a compatible Bun version is in use.
  # bun build --compile --target "${TARGET}" \
  #   --assets "${REPO_ROOT}/packages/dashboard/dist" \
  #   "${BUN_EXTERNAL[@]}" \
  #   "${REPO_ROOT}/packages/core/src/cli.ts" \
  #   --outfile "${OUTFILE}"
  bun build --compile --target "${TARGET}" \
    "${BUN_EXTERNAL[@]}" \
    "${REPO_ROOT}/packages/core/src/cli.ts" \
    --outfile "${OUTFILE}"
}

# Agent binary: uses agent/cli.ts entry point which imports soul, AI, auth,
# security, and A2A. Tree-shakes out brain/RAG, training, analytics, simulation,
# dashboard, marketplace, and enterprise compliance subsystems.
AGENT_EXTERNAL=(
  "${BUN_EXTERNAL[@]}"
  --external "@qdrant/js-client-rest"
  --external "faiss-node"
  --external "pdfjs-dist"
  --external "sharp"
  --external "mammoth"
  --external "xlsx"
  --external "csv-parse"
)

compile_agent_binary() {
  local TARGET="$1"
  local OUTFILE="$2"
  bun build --compile --target "${TARGET}" \
    "${AGENT_EXTERNAL[@]}" \
    "${REPO_ROOT}/packages/core/src/agent/cli.ts" \
    --outfile "${OUTFILE}"
}

# ── Rust sy-edge binary (native target only) ─────────────────────────────────
# Cross-compile support (arm64/armv7/riscv64) will return in a follow-up via
# `cross` or rustup target-specific linkers.
compile_rust_edge() {
  local OUTFILE="$1"
  echo "    → edge-linux-x64 (Rust)"
  (cd "${REPO_ROOT}/crates" && cargo build --release --bin sy-edge)
  cp "${REPO_ROOT}/crates/target/release/sy-edge" "${OUTFILE}"
}

# ── Edge-only mode: skip Tier 1 + 2, build only Rust edge ────────────────────
if [[ "$EDGE_ONLY" == true ]]; then
  echo "==> Edge-only mode: building Rust sy-edge binary..."
  compile_rust_edge "${DIST_DIR}/secureyeoman-${DATE_TAG}-edge-linux-x64"

  echo ""
  echo "==> Edge build complete. Binaries:"
  ls -lh "${DIST_DIR}"/secureyeoman-*-edge-*
  exit 0
fi

# ── Agent-only mode: skip Tier 1 + 2 + 3, build only agent ────────────
if [[ "$AGENT_ONLY" == true ]]; then
  echo "==> Agent-only mode: building Tier 2.5 agent binaries..."

  if [[ "$DEV_MODE" == true ]]; then
    echo "    → ${DATE_TAG}-agent-${DEV_TARGET#bun-}"
    compile_agent_binary "${DEV_TARGET}" "${DIST_DIR}/secureyeoman-${DATE_TAG}-agent-${DEV_TARGET#bun-}"
  else
    for TARGET in bun-linux-x64 bun-linux-arm64 bun-darwin-arm64; do
      PLATFORM="${TARGET#bun-}"
      echo "    → ${DATE_TAG}-agent-${PLATFORM}"
      compile_agent_binary "${TARGET}" "${DIST_DIR}/secureyeoman-${DATE_TAG}-agent-${PLATFORM}"
    done
  fi

  echo ""
  echo "==> Agent build complete. Binaries:"
  ls -lh "${DIST_DIR}"/secureyeoman-*-agent-*
  exit 0
fi

# ── Tier 1: PostgreSQL-backed binaries ────────────────────────────────────────
if [[ "$DEV_MODE" == true ]]; then
  TIER1_TARGETS=("${DEV_TARGET}")
else
  TIER1_TARGETS=(bun-linux-x64 bun-linux-arm64 bun-darwin-arm64 bun-windows-x64)
fi

echo "==> Compiling Tier 1 binaries (PostgreSQL-backed)..."
for TARGET in "${TIER1_TARGETS[@]}"; do
  PLATFORM="${TARGET#bun-}"
  EXT=""
  [[ "$PLATFORM" == windows-* ]] && EXT=".exe"
  echo "    → ${DATE_TAG}-${PLATFORM}"
  compile_binary "${TARGET}" "${DIST_DIR}/secureyeoman-${DATE_TAG}-${PLATFORM}${EXT}"
done

# ── Tier 2: SQLite (full platform, no PostgreSQL) ─────────────────────────────
if [[ "$DEV_MODE" == false ]]; then
  echo "==> Compiling Tier 2 SQLite binaries (SQLite, no native addons)..."
  for TARGET in bun-linux-x64 bun-linux-arm64 bun-windows-x64; do
    PLATFORM="${TARGET#bun-}"
    EXT=""
    [[ "$PLATFORM" == windows-* ]] && EXT=".exe"
    echo "    → ${DATE_TAG}-sqlite-${PLATFORM}"
    SECUREYEOMAN_BUILD_TIER=lite compile_binary "${TARGET}" "${DIST_DIR}/secureyeoman-${DATE_TAG}-sqlite-${PLATFORM}${EXT}"
  done
fi

# ── Tier 2.5: Agent (soul + AI, SQLite, no brain/training/dashboard) ──────────
if [[ "$DEV_MODE" == false ]]; then
  echo "==> Compiling Tier 2.5 agent binaries (soul + AI agent runtime)..."
  for TARGET in bun-linux-x64 bun-linux-arm64 bun-darwin-arm64; do
    PLATFORM="${TARGET#bun-}"
    echo "    → ${DATE_TAG}-agent-${PLATFORM}"
    compile_agent_binary "${TARGET}" "${DIST_DIR}/secureyeoman-${DATE_TAG}-agent-${PLATFORM}"
  done
else
  echo "==> Compiling Tier 2.5 agent binary (dev, current platform)..."
  echo "    → ${DATE_TAG}-agent-${DEV_TARGET#bun-}"
  compile_agent_binary "${DEV_TARGET}" "${DIST_DIR}/secureyeoman-${DATE_TAG}-agent-${DEV_TARGET#bun-}"
fi

# ── Tier 3: Edge (Rust sy-edge binary, native linux-x64) ─────────────────────
if [[ "$DEV_MODE" == false ]]; then
  echo "==> Compiling Tier 3 Rust sy-edge binary (minimal A2A runtime)..."
  compile_rust_edge "${DIST_DIR}/secureyeoman-${DATE_TAG}-edge-linux-x64"
fi

# ── Checksums ─────────────────────────────────────────────────────────────────
echo ""
if [[ "$DEV_MODE" == false ]]; then
  echo "==> Generating checksums..."
  (cd "${DIST_DIR}" && sha256sum secureyeoman-* > SHA256SUMS)
  cat "${DIST_DIR}/SHA256SUMS"
  echo ""
fi

echo "==> Build complete. Binaries:"
ls -lh "${DIST_DIR}"/secureyeoman-*
