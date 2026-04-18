#!/bin/bash
# install.sh — SecureYeoman one-line installer
#
# Usage:
#   curl -fsSL https://secureyeoman.ai/install | bash
#   curl -fsSL https://secureyeoman.ai/install | bash -s -- --dir /usr/local/bin
#   curl -fsSL https://secureyeoman.ai/install | bash -s -- --edge
#
# Options:
#   --dir <path>    Installation directory (default: /usr/local/bin)
#   --version <v>  Specific version to install (default: latest)
#   --edge          Install the minimal edge binary (sy-edge, Linux x64 only)

set -e

INSTALL_DIR="/usr/local/bin"
VERSION=""
TIER="core"  # core | edge

while [[ $# -gt 0 ]]; do
  case $1 in
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --edge) TIER="edge"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Detect OS and architecture
_UNAME_S=$(uname -s)
ARCH=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/;s/arm64/arm64/')

case "$_UNAME_S" in
  Linux*)   OS="linux" ;;
  Darwin*)  OS="darwin" ;;
  MINGW*|MSYS*|CYGWIN*)
    OS="windows"
    INSTALL_DIR="${INSTALL_DIR:-$USERPROFILE/bin}"
    ;;
  *)
    echo "Unsupported OS: $_UNAME_S (supported: linux, darwin, windows via Git Bash)"
    exit 1
    ;;
esac

# Get latest version if not specified
if [[ -z "$VERSION" ]]; then
  VERSION=$(curl -sf https://api.github.com/repos/MacCracken/secureyeoman/releases/latest \
    | grep '"tag_name"' | cut -d'"' -f4)
  if [[ -z "$VERSION" ]]; then
    echo "Could not determine latest version. Specify with --version <tag>"
    exit 1
  fi
fi

# Binary naming: secureyeoman-<VERSION>-[edge-]<os>-<arch>[.exe]
# (SemVer era — CalVer date-tag prefix retired at 0.5.0)
if [[ "$TIER" == "edge" ]]; then
  if [[ "$OS" != "linux" || "$ARCH" != "x64" ]]; then
    echo "--edge currently supports linux-x64 only (cross-compile for arm64/armv7/riscv64 is planned)."
    exit 1
  fi
  BINARY_NAME="secureyeoman-${VERSION}-edge-linux-x64"
elif [[ "$OS" == "windows" ]]; then
  BINARY_NAME="secureyeoman-${VERSION}-windows-${ARCH}.exe"
else
  BINARY_NAME="secureyeoman-${VERSION}-${OS}-${ARCH}"
fi

URL="https://github.com/MacCracken/secureyeoman/releases/download/${VERSION}/${BINARY_NAME}"
if [[ "$TIER" == "edge" ]]; then
  DEST="${INSTALL_DIR}/secureyeoman-edge"
elif [[ "$OS" == "windows" ]]; then
  DEST="${INSTALL_DIR}/secureyeoman.exe"
else
  DEST="${INSTALL_DIR}/secureyeoman"
fi

echo "Installing secureyeoman ${VERSION} (${OS}/${ARCH})..."
echo "  Source: ${URL}"
echo "  Destination: ${DEST}"

mkdir -p "$INSTALL_DIR"

# Download
if command -v curl &>/dev/null; then
  curl -fsSL "$URL" -o "$DEST"
elif command -v wget &>/dev/null; then
  wget -qO "$DEST" "$URL"
else
  echo "Error: curl or wget is required"
  exit 1
fi

[[ "$OS" != "windows" ]] && chmod +x "$DEST"

echo ""
echo "✓ secureyeoman ${VERSION} installed at ${DEST}"
echo ""
echo "Next steps:"
echo "  secureyeoman init          # Interactive setup wizard"
echo "  secureyeoman start         # Start the server (requires PostgreSQL)"
echo ""
echo "For SQLite (no external DB):"
echo "  DATABASE_URL='' secureyeoman start"
