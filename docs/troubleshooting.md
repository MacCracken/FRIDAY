# Troubleshooting Guide

## Startup Issues

### "SecureYeoman initialization failed"
**Cause:** Missing or invalid environment variables.
**Fix:** Ensure all required env vars are set:
```bash
export SECUREYEOMAN_TOKEN_SECRET="$(openssl rand -base64 32)"
export SECUREYEOMAN_ADMIN_PASSWORD="your-strong-password"
export SECUREYEOMAN_SIGNING_KEY="$(openssl rand -base64 32)"
export SECUREYEOMAN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
```

### "EADDRINUSE: address already in use"
**Cause:** Port 18789 (gateway) or 3000 (dashboard) is already in use.
**Fix:** Kill the existing process or change the port:
```bash
lsof -i :18789 | grep LISTEN
lsof -i :3000 | grep LISTEN
kill -9 <PID>
# Or set a different gateway port
export SECUREYEOMAN_GATEWAY_PORT=18790
```

### "Database is locked"
**Cause:** Another process has an exclusive lock on the SQLite database.
**Fix:** Check for orphaned processes:
```bash
ps aux | grep secureyeoman
# Kill any stale processes
```

## Authentication Issues

### "Invalid credentials" on login
**Cause:** Wrong admin password.
**Fix:** Check the `SECUREYEOMAN_ADMIN_PASSWORD` env var matches what you're sending.

### JWT token expired immediately
**Cause:** Clock skew between server and client.
**Fix:** Sync system clock: `sudo ntpdate pool.ntp.org`

### Rate limited on login
**Cause:** Too many failed login attempts (5 per 15 minutes).
**Fix:** Wait 15 minutes or restart the server to clear rate limit state.

## Integration Issues

### Telegram bot not responding
**Cause:** Bot token is invalid or bot was not started via the API.
**Fix:**
1. Verify bot token with `curl https://api.telegram.org/bot<TOKEN>/getMe`
2. Check integration status: `GET /api/v1/integrations`
3. Start if stopped: `POST /api/v1/integrations/:id/start`

### Discord bot "Missing Access"
**Cause:** Bot doesn't have required permissions or intents.
**Fix:**
1. Enable **Message Content Intent** in Discord Developer Portal > Bot
2. Ensure bot has `Send Messages` and `Read Message History` permissions
3. Re-invite with correct scopes: `bot` + `applications.commands`

### Slack "not_authed" error
**Cause:** Invalid bot token or app token.
**Fix:**
1. Regenerate bot token in Slack app settings
2. Ensure Socket Mode is enabled and `xapp-` token is valid
3. Verify required scopes: `chat:write`, `app_mentions:read`

### GitHub webhooks not received
**Cause:** Webhook URL is unreachable or secret mismatch.
**Fix:**
1. Check webhook delivery status in GitHub repo Settings > Webhooks
2. Ensure the server is publicly accessible (or use ngrok for dev)
3. Verify webhook secret matches the integration config

## Performance Issues

### High memory usage
**Cause:** Large number of cached messages or unprocessed tasks.
**Fix:**
1. Check metrics: `GET /metrics`
2. Reduce conversation window: set `windowSize` in config
3. Increase Node.js heap: `NODE_OPTIONS="--max-old-space-size=1024"`

### Slow API responses
**Cause:** Database queries running slow under load.
**Fix:**
1. Enable WAL mode (default): `PRAGMA journal_mode=WAL`
2. Check disk I/O: `iostat -x 1`
3. Consider enabling FTS for audit search queries

### WebSocket disconnections
**Cause:** Proxy timeout or network instability.
**Fix:**
1. Configure proxy keep-alive (nginx: `proxy_read_timeout 86400;`)
2. Client should implement auto-reconnect with backoff

## Database Issues

### "SQLITE_CORRUPT" error
**Cause:** Database file corruption (power loss, disk failure).
**Fix:**
1. Check integrity: `sqlite3 <db> "PRAGMA integrity_check"`
2. If corrupt, restore from backup
3. Delete WAL/SHM files and retry: `rm *.db-wal *.db-shm`

### Audit chain verification failed
**Cause:** Entries were modified or deleted outside the application.
**Fix:**
1. Run verification: `POST /api/v1/audit/verify`
2. Check for unauthorized database modifications
3. Review server logs for tampering indicators

## Monitoring

### Prometheus not scraping
**Fix:**
1. Verify `/metrics` endpoint is accessible
2. Check Prometheus config targets
3. Ensure server is not behind auth for the metrics endpoint

### Grafana "No data"
**Fix:**
1. Check Prometheus is scraping successfully
2. Verify the datasource is configured correctly
3. Check time range in Grafana matches when data was collected
