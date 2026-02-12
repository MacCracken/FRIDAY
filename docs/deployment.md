# Deployment Guide

## Requirements

- Node.js 20+ (LTS recommended)
- 512MB+ RAM
- 1GB+ disk space

## Bare Metal

### Install

```bash
git clone https://github.com/your-org/friday.git
cd friday
npm ci
npm run build
```

### Configure

```bash
# Required environment variables
export SECUREYEOMAN_TOKEN_SECRET="$(openssl rand -base64 32)"
export SECUREYEOMAN_ADMIN_PASSWORD="your-strong-password-here"
export SECUREYEOMAN_SIGNING_KEY="$(openssl rand -base64 32)"
export SECUREYEOMAN_ENCRYPTION_KEY="$(openssl rand -base64 32)"

# Optional: AI provider
export ANTHROPIC_API_KEY="sk-ant-..."
# Or: OPENAI_API_KEY, GOOGLE_API_KEY

# Optional: Customization
export SECUREYEOMAN_GATEWAY_PORT=18789
export SECUREYEOMAN_ENVIRONMENT=production
export SECUREYEOMAN_LOG_LEVEL=info
```

### Run

```bash
# Direct
node packages/core/dist/cli.js

# With systemd (see below)
sudo systemctl start friday
```

### systemd Service

```ini
# /etc/systemd/system/friday.service
[Unit]
Description=FRIDAY Agent
After=network.target

[Service]
Type=simple
User=friday
Group=friday
WorkingDirectory=/opt/friday
ExecStart=/usr/bin/node packages/core/dist/cli.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/etc/friday/env

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/friday/data /var/log/friday
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable friday
sudo systemctl start friday
```

## Docker

### Build

```bash
docker build -t friday:latest .
```

### Run

```bash
docker run -d \
  --name friday \
  -p 18789:18789 \
  -v friday-data:/app/data \
  -e SECUREYEOMAN_TOKEN_SECRET="$(openssl rand -base64 32)" \
  -e SECUREYEOMAN_ADMIN_PASSWORD="your-password" \
  -e SECUREYEOMAN_SIGNING_KEY="$(openssl rand -base64 32)" \
  -e SECUREYEOMAN_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  friday:latest
```

### Docker Compose

```yaml
version: "3.8"
services:
  friday:
    build: .
    ports:
      - "18789:18789"
    volumes:
      - friday-data:/app/data
    env_file: .env
    restart: unless-stopped

volumes:
  friday-data:
```

## Reverse Proxy

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name friday.example.com;

    ssl_certificate /etc/letsencrypt/live/friday.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/friday.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /api/v1/ws {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # GitHub webhooks (no auth required)
    location /api/v1/webhooks/ {
        proxy_pass http://127.0.0.1:18789;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Prometheus metrics
    location /metrics {
        proxy_pass http://127.0.0.1:18789;
        # Optionally restrict to internal networks
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
    }
}
```

### Caddy

```
friday.example.com {
    reverse_proxy localhost:18789
}
```

## Monitoring Stack

Deploy the full observability stack:

```bash
cd deploy/logging
docker compose -f docker-compose-loki.yml up -d
```

This starts:
- **Loki** (port 3100) — Log aggregation
- **Promtail** — Log collection
- **Grafana** (port 3001) — Dashboards
- **Prometheus** (port 9090) — Metrics

Import the Grafana dashboard from `deploy/grafana/friday-dashboard.json`.

## Backup

### Database Backup

```bash
# Stop the service
sudo systemctl stop friday

# Copy database files
cp /opt/friday/data/*.db /backup/friday/

# Restart
sudo systemctl start friday
```

### Automated Backup Script

```bash
#!/bin/bash
BACKUP_DIR="/backup/friday/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"
sqlite3 /opt/friday/data/audit.db ".backup '$BACKUP_DIR/audit.db'"
sqlite3 /opt/friday/data/tasks.db ".backup '$BACKUP_DIR/tasks.db'"
# Retain 30 days
find /backup/friday -type d -mtime +30 -exec rm -rf {} +
```
