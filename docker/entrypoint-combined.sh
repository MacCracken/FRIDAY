#!/bin/sh
# Combined entrypoint: configures TLS (Caddy) and process supervision (supervisord)
# for AGNOS services (LLM Gateway + Agent Runtime) and SecureYeoman.
set -e
# Signal handling: exec supervisord replaces this shell (PID 1),
# so SIGTERM goes directly to supervisord which manages child shutdown.

# PostgreSQL binaries (Debian packages install to /usr/lib/postgresql/<ver>/bin/)
export PATH="/usr/lib/postgresql/17/bin:$PATH"

AGNOS_VERSION="$(cat /etc/agnos/VERSION 2>/dev/null || echo 'unknown')"
echo "AGNOS v${AGNOS_VERSION} + SecureYeoman starting..."

# --- AGNOS defaults ---
export AGNOS_LOG_FORMAT="${AGNOS_LOG_FORMAT:-json}"
export RUST_LOG="${RUST_LOG:-info}"
export AGNOS_RUNTIME_BIND="${AGNOS_RUNTIME_BIND:-127.0.0.1}"
export AGNOS_GATEWAY_BIND="${AGNOS_GATEWAY_BIND:-127.0.0.1}"
export AGNOS_GATEWAY_URL="${AGNOS_GATEWAY_URL:-http://127.0.0.1:8088}"
export AGNOS_RUNTIME_URL="${AGNOS_RUNTIME_URL:-http://127.0.0.1:8090}"

# --- Unified TLS env vars ---
# Support both TLS_* (unified) and SECUREYEOMAN_TLS_* (legacy) with unified taking precedence
export TLS_ENABLED="${TLS_ENABLED:-${SECUREYEOMAN_TLS_ENABLED:-false}}"
export TLS_CERT_PATH="${TLS_CERT_PATH:-${SECUREYEOMAN_TLS_CERT_PATH:-}}"
export TLS_KEY_PATH="${TLS_KEY_PATH:-${SECUREYEOMAN_TLS_KEY_PATH:-}}"
export TLS_DOMAIN="${TLS_DOMAIN:-localhost}"
export TLS_PORT="${TLS_PORT:-443}"

# --- Generate Caddyfile from template ---
if [ "$TLS_ENABLED" = "true" ]; then
    echo "TLS enabled — configuring Caddy reverse proxy..."

    # Determine TLS directive for Caddyfile
    if [ -n "$TLS_CERT_PATH" ] && [ -n "$TLS_KEY_PATH" ]; then
        echo "  Mode A: Using provided certificates"
        export TLS_CERT_DIRECTIVE="${TLS_CERT_PATH} ${TLS_KEY_PATH}"
    else
        echo "  Mode B: Auto HTTPS (ACME) for domain ${TLS_DOMAIN}"
        # Empty directive = Caddy auto-obtains certs
        export TLS_CERT_DIRECTIVE=""
    fi

    envsubst < /etc/caddy/Caddyfile.template > /etc/caddy/Caddyfile

    # sy-core serves HTTP on 0.0.0.0:18789 for internal container traffic;
    # Caddy terminates TLS on 443 for external access.
    export SECUREYEOMAN_HOST="${SECUREYEOMAN_HOST:-0.0.0.0}"
    export SECUREYEOMAN_TLS_ENABLED="false"  # sy-core stays HTTP; Caddy terminates TLS
    export TLS_ENABLED="false"               # Ensure sy-core doesn't pick up TLS from env_file
    export TLS_TERMINATED_BY_PROXY="true"    # Tell sy-core TLS is handled by Caddy

    # Write supervisord override to enable caddy
    cat > /tmp/supervisord-caddy.conf <<OVERRIDE
[program:caddy]
autostart=true
OVERRIDE
else
    echo "TLS disabled — sy-core serves HTTP directly"
    # Ensure caddy stays off
    cat > /tmp/supervisord-caddy.conf <<OVERRIDE
[program:caddy]
autostart=false
OVERRIDE
fi

# ── Embedded PostgreSQL ─────────────────────────────────────────
# Skip embedded PG when DATABASE_HOST points to an external server.
# For HA deployments, set DATABASE_HOST to your external PostgreSQL.

_db_host="${DATABASE_HOST:-}"
_use_embedded_pg=true

if [ -n "$_db_host" ] && [ "$_db_host" != "localhost" ] && [ "$_db_host" != "127.0.0.1" ]; then
  _use_embedded_pg=false
  echo "[entrypoint] Using external PostgreSQL at $_db_host"
fi

if [ "$_use_embedded_pg" = "true" ]; then
  echo "[entrypoint] Starting embedded PostgreSQL..."

  export DATABASE_HOST="127.0.0.1"
  export DATABASE_USER="${DATABASE_USER:-secureyeoman}"
  export DATABASE_NAME="${DATABASE_NAME:-secureyeoman}"

  # Auto-generate POSTGRES_PASSWORD for embedded PG if not set.
  # Persists to /var/lib/postgresql/.pg_password so it survives restarts.
  _pg_pw_file="/var/lib/postgresql/.pg_password"
  if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    if [ -f "$_pg_pw_file" ]; then
      _pg_pass="$(cat "$_pg_pw_file")"
      echo "[entrypoint] Using persisted embedded PG password"
    else
      _pg_pass="$(head -c 32 /dev/urandom | base64 | tr -d '+/=' | head -c 32)"
      echo "[entrypoint] Auto-generated embedded PG password"
    fi
    export POSTGRES_PASSWORD="$_pg_pass"
  else
    _pg_pass="$POSTGRES_PASSWORD"
  fi

  # Ensure directories exist
  install -d -o postgres -g postgres -m 700 /var/lib/postgresql/data
  install -d -o postgres -g postgres -m 755 /run/postgresql

  # Initialize cluster if needed
  if [ ! -s /var/lib/postgresql/data/PG_VERSION ]; then
    echo "[entrypoint] Initializing PostgreSQL data directory..."
    gosu postgres initdb -D /var/lib/postgresql/data --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8 -U postgres
    cp /etc/postgresql/postgresql.conf /var/lib/postgresql/data/postgresql.conf
    # Allow local connections from secureyeoman user
    echo "host all all 127.0.0.1/32 scram-sha-256" >> /var/lib/postgresql/data/pg_hba.conf
    # Persist auto-generated password for volume-mounted restarts
    printf '%s' "$_pg_pass" > "$_pg_pw_file"
    chown postgres:postgres "$_pg_pw_file"
    chmod 600 "$_pg_pw_file"
  fi

  # Clean stale PID file from previous container crash/restart
  rm -f /var/lib/postgresql/data/postmaster.pid

  # Start postgres temporarily to create user/database
  gosu postgres pg_ctl -D /var/lib/postgresql/data -l /tmp/pg_init.log start -w -t 30

  # Create user and database if they don't exist
  gosu postgres psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname = '$DATABASE_USER'" | grep -q 1 || \
    gosu postgres psql -U postgres -c "CREATE ROLE \"$DATABASE_USER\" WITH LOGIN PASSWORD '$(printf '%s' "$_pg_pass" | sed "s/'/''/g")'"
  gosu postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'" | grep -q 1 || \
    gosu postgres psql -U postgres -c "CREATE DATABASE \"$DATABASE_NAME\" OWNER \"$DATABASE_USER\" ENCODING 'UTF8' TEMPLATE template0"

  # Install pgvector extension and grant ownership to app user
  gosu postgres psql -U postgres -d "$DATABASE_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector"
  gosu postgres psql -U postgres -d "$DATABASE_NAME" -c "GRANT ALL ON SCHEMA public TO \"$DATABASE_USER\""
  gosu postgres psql -U postgres -d "$DATABASE_NAME" -c "ALTER DATABASE \"$DATABASE_NAME\" OWNER TO \"$DATABASE_USER\""
  gosu postgres psql -U postgres -d "$DATABASE_NAME" -c "GRANT CREATE ON DATABASE \"$DATABASE_NAME\" TO \"$DATABASE_USER\""
  # Make secureyeoman a superuser for extension management during migrations.
  # Embedded PG is only accessible from localhost — SUPERUSER is safe here.
  # Migrations (run by SY on startup) need it for CREATE EXTENSION, ALTER EXTENSION, etc.
  gosu postgres psql -U postgres -c "ALTER ROLE \"$DATABASE_USER\" WITH SUPERUSER"

  # Stop — supervisord will manage it from here
  gosu postgres pg_ctl -D /var/lib/postgresql/data stop -w -t 10

  # Enable postgres in supervisord
  cat > /tmp/supervisord-postgres.conf <<PGEOF
[program:postgres]
autostart=true
PGEOF

  echo "[entrypoint] Embedded PostgreSQL ready (user=$DATABASE_USER, db=$DATABASE_NAME)"
fi

# --- Ensure shared data volume is writable by secureyeoman ---
# The volume may have been created by another service (e.g. AGNOS) with different ownership.
# secureyeoman needs write access to share the token secret with the MCP sidecar.
chown secureyeoman:secureyeoman /home/secureyeoman/.secureyeoman 2>/dev/null || true

# --- Set the command for secureyeoman process ---
# $@ comes from CMD in Dockerfile (e.g. "secureyeoman start" or "node ... start")
export SY_CMD="$*"

exec supervisord -c /etc/supervisord.conf
