#!/usr/bin/env bash
# Mint a self-signed Ed25519 cert+key for the probe's HTTPS listener.
#
# tls_native (the pure-Cyrius server TLS stack) supports Ed25519 / ECDSA P-256 /
# P-384 private keys but REJECTS RSA (TLS_ERR_KEY_UNSUPPORTED) — so this uses
# Ed25519. Output is cert.pem (leaf, loaded via sigil pem_decode_certs) + key.pem
# (PKCS#8, passed to tls_native_new_server as PEM). Both are gitignored
# (*.pem / *.key) — regenerate locally, like lib/. Reproducible: ./gen-certs.sh
set -euo pipefail
cd "$(dirname "$0")"

openssl req -x509 -newkey ed25519 -nodes \
  -keyout key.pem -out cert.pem -days 3650 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "✓ minted cert.pem + key.pem (Ed25519, CN=localhost, SAN localhost/127.0.0.1)"
