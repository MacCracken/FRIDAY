# Dockerfile — Binary-based image on AGNOS base
#
# Uses ghcr.io/maccracken/agnosticos:latest as the base, giving SecureYeoman
# built-in LLM Gateway (port 8088) and Agent Runtime (port 8090).
#
# Build the binary first with:
#   npm run build:binary
#
# Then build this image:
#   docker build -t secureyeoman .

FROM ghcr.io/maccracken/agnosticos:2026.3.31

LABEL org.opencontainers.image.source="https://github.com/MacCracken/secureyeoman"
LABEL org.opencontainers.image.description="SecureYeoman — Secure, local-first AI assistant (on AGNOS)"
LABEL org.opencontainers.image.licenses="MIT"

USER root

RUN apt-get update && apt-get install -y --no-install-recommends git wget gettext-base supervisor \
    postgresql-17 postgresql-17-pgvector gosu \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1001 secureyeoman && useradd -u 1001 -g secureyeoman -G agnos -d /home/secureyeoman -m secureyeoman \
 && mkdir -p /home/secureyeoman/.secureyeoman/data /home/secureyeoman/.secureyeoman/workspace \
 && chown -R secureyeoman:secureyeoman /home/secureyeoman \
 && mkdir -p /usr/share/secureyeoman/community-repo \
 && chown -R secureyeoman:secureyeoman /usr/share/secureyeoman \
 && chown -R secureyeoman:agnos /run/agnos /var/lib/agnos /var/log/agnos /etc/agnos

# Install Caddy static binary
RUN curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy \
 && chmod +x /usr/local/bin/caddy

ENV COMMUNITY_REPO_PATH=/usr/share/secureyeoman/community-repo

# Copy the pre-built binary (built via npm run build:binary)
COPY dist/secureyeoman-linux-x64 /usr/local/bin/secureyeoman
RUN chmod +x /usr/local/bin/secureyeoman

# SQL migration files
COPY dist/migrations/ /usr/local/bin/migrations/

# Embedded PostgreSQL config
COPY docker/postgresql.conf /etc/postgresql/postgresql.conf
RUN mkdir -p /etc/postgresql /var/lib/postgresql/data /run/postgresql \
 && chown -R postgres:postgres /var/lib/postgresql /run/postgresql /etc/postgresql

# Supervisord + Caddy config
COPY docker/supervisord.conf /etc/supervisord.conf
COPY docker/Caddyfile.template /etc/caddy/Caddyfile.template
RUN mkdir -p /var/log/supervisor /etc/caddy /data/caddy \
 && chown -R secureyeoman:secureyeoman /etc/caddy /data/caddy /var/log/supervisor

# Combined entrypoint: configures TLS + supervisord
COPY docker/entrypoint-combined.sh /usr/local/bin/entrypoint-combined.sh
RUN chmod +x /usr/local/bin/entrypoint-combined.sh

# Use JSON log format (pino-pretty not bundled in standalone binary)
ENV SECUREYEOMAN_LOG_FORMAT=json

EXPOSE 18789 443 5432 8088 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD secureyeoman health --json || exit 1

# Entrypoint runs as root for PG init; supervisord drops to secureyeoman/postgres per program.
ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint-combined.sh"]
CMD ["secureyeoman", "start"]
