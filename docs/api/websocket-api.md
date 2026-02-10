# WebSocket API Reference

> Real-time communication for F.R.I.D.A.Y. dashboard and clients

## Connection

### WebSocket URL

```
Development: ws://localhost:18789/ws
Production: wss://your-domain.com/ws
```

### Authentication

WebSocket connections require authentication via query parameters:

```javascript
// With JWT token
const ws = new WebSocket('ws://localhost:18789/ws?token=<jwt-token>');

// With API key
const ws = new WebSocket('ws://localhost:18789/ws?api_key=<api-key>');
```

---

## Message Protocol

### Client → Server

#### Subscribe to Channels

```json
{
  "type": "subscribe",
  "payload": {
    "channels": ["metrics", "tasks", "security"]
  }
}
```

#### Unsubscribe from Channels

```json
{
  "type": "unsubscribe",
  "payload": {
    "channels": ["tasks"]
  }
}
```

#### Send Command

```json
{
  "type": "command",
  "payload": {
    "command": "create_task",
    "args": {
      "type": "execute",
      "input": { "command": "echo hello" }
    }
  }
}
```

### Server → Client

#### Update Message

```json
{
  "type": "update",
  "channel": "metrics",
  "payload": {
    "cpu_percent": 45,
    "memory_used_mb": 512,
    "tokens_today": 10000
  },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "sequence": 12345
}
```

#### Event Message

```json
{
  "type": "event",
  "channel": "tasks",
  "payload": {
    "event_type": "completed",
    "task_id": "task_123",
    "duration_ms": 1500
  },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "sequence": 12346
}
```

#### Error Message

```json
{
  "type": "error",
  "channel": "system",
  "payload": {
    "code": "INVALID_COMMAND",
    "message": "Unknown command: invalid_command"
  },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "sequence": 12347
}
```

#### Acknowledgment

```json
{
  "type": "ack",
  "channel": "system",
  "payload": {
    "message": "Subscribed to channels: metrics, tasks"
  },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "sequence": 12348
}
```

---

## Channels

### metrics

Real-time system resource metrics.

**Update Frequency**: Every 1 second

**Payload Example**
```json
{
  "cpu_percent": 45,
  "memory_used_mb": 512,
  "memory_limit_mb": 1024,
  "memory_percent": 50,
  "disk_used_mb": 2048,
  "disk_limit_mb": 10240,
  "disk_percent": 20,
  "tokens_today": 10000,
  "tokens_limit": 100000,
  "cost_today_usd": 2.34,
  "network_sent_bytes": 1048576,
  "network_received_bytes": 2097152,
  "active_tasks": 3,
  "queue_depth": 5
}
```

### tasks

Task lifecycle events.

**Event Types**
- `created` - New task queued
- `started` - Task execution began
- `completed` - Task finished successfully
- `failed` - Task failed with error
- `cancelled` - Task was cancelled
- `timeout` - Task exceeded time limit

**Payload Examples**

#### Task Created
```json
{
  "event_type": "created",
  "task_id": "task_456",
  "type": "execute",
  "priority": "normal",
  "estimated_duration_ms": 5000
}
```

#### Task Completed
```json
{
  "event_type": "completed",
  "task_id": "task_123",
  "duration_ms": 1500,
  "tokens_used": 50,
  "output_summary": "Command executed successfully"
}
```

#### Task Failed
```json
{
  "event_type": "failed",
  "task_id": "task_789",
  "duration_ms": 30000,
  "error_code": "TIMEOUT",
  "error_message": "Task exceeded 30 second timeout"
}
```

### security

Security-related events and alerts.

**Event Types**
- `auth_success` - Successful authentication
- `auth_failure` - Failed authentication attempt
- `permission_denied` - Access denied
- `rate_limit` - Rate limit exceeded
- `injection_attempt` - Potential injection attack detected
- `sandbox_violation` - Sandbox rule broken
- `anomaly` - Unusual activity detected

**Payload Examples**

#### Authentication Failure
```json
{
  "event_type": "auth_failure",
  "severity": "warn",
  "user_id": "user_123",
  "ip_address": "192.168.1.1",
  "reason": "invalid_password",
  "attempts": 3
}
```

#### Rate Limit Hit
```json
{
  "event_type": "rate_limit",
  "severity": "warn",
  "user_id": "user_456",
  "ip_address": "192.168.1.2",
  "rule": "api_requests",
  "limit": 100,
  "window_seconds": 60
}
```

#### Sandbox Violation
```json
{
  "event_type": "sandbox_violation",
  "severity": "error",
  "task_id": "task_789",
  "violation_type": "filesystem_access",
  "blocked_path": "/etc/passwd",
  "allowed_paths": ["/tmp", "/home/user/workspace"]
}
```

### connections

Platform connection status updates.

**Event Types**
- `connected` - Platform successfully connected
- `disconnected` - Platform disconnected
- `error` - Connection error occurred
- `message_received` - New message from platform
- `message_sent` - Message sent to platform

**Payload Examples**

#### Connected
```json
{
  "event_type": "connected",
  "platform": "telegram",
  "connection_id": "conn_123",
  "user_count": 150
}
```

#### Message Received
```json
{
  "event_type": "message_received",
  "platform": "discord",
  "message_id": "msg_456",
  "user_id": "user_789",
  "channel_id": "channel_123",
  "content": "hello bot"
}
```

### system

System health and status events.

**Event Types**
- `startup` - System started
- `shutdown` - System shutting down
- `health_check` - Health check results
- `config_change` - Configuration updated
- `alert` - System alert or warning

**Payload Examples**

#### System Startup
```json
{
  "event_type": "startup",
  "version": "0.1.0",
  "uptime_seconds": 0,
  "capabilities": {
    "sandbox": true,
    "rbac": true,
    "audit": true
  }
}
```

#### Health Check
```json
{
  "event_type": "health_check",
  "status": "healthy",
  "checks": {
    "database": "ok",
    "ai_provider": "ok",
    "sandbox": "ok"
  }
}
```

---

## Client Implementation Examples

### JavaScript/TypeScript

```typescript
class FridayWebSocket {
  private ws: WebSocket;
  private subscriptions: Set<string> = new Set();
  private messageHandlers: Map<string, (payload: any) => void> = new Map();

  constructor(url: string, token?: string, apiKey?: string) {
    const auth = token ? `?token=${token}` : apiKey ? `?api_key=${apiKey}` : '';
    this.ws = new WebSocket(`${url}${auth}`);
    
    this.ws.onopen = () => {
      console.log('Connected to F.R.I.D.A.Y. WebSocket');
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('Disconnected from WebSocket');
      // Implement reconnection logic
      setTimeout(() => this.reconnect(), 5000);
    };
  }

  subscribe(channels: string[]) {
    const message = {
      type: 'subscribe',
      payload: { channels }
    };
    this.ws.send(JSON.stringify(message));
    channels.forEach(ch => this.subscriptions.add(ch));
  }

  unsubscribe(channels: string[]) {
    const message = {
      type: 'unsubscribe',
      payload: { channels }
    };
    this.ws.send(JSON.stringify(message));
    channels.forEach(ch => this.subscriptions.delete(ch));
  }

  on(channel: string, handler: (payload: any) => void) {
    this.messageHandlers.set(channel, handler);
  }

  private handleMessage(message: any) {
    const { type, channel, payload } = message;
    
    if (type === 'update' || type === 'event') {
      const handler = this.messageHandlers.get(channel);
      if (handler) {
        handler(payload);
      }
    }
  }

  private reconnect() {
    // Implement exponential backoff reconnection
    console.log('Attempting to reconnect...');
  }
}

// Usage
const client = new FridayWebSocket('ws://localhost:18789/ws', token);

client.subscribe(['metrics', 'tasks', 'security']);

client.on('metrics', (metrics) => {
  console.log('Metrics update:', metrics);
  // Update UI with new metrics
});

client.on('tasks', (event) => {
  console.log('Task event:', event);
  // Update task list or show notifications
});

client.on('security', (event) => {
  console.log('Security event:', event);
  // Show security alerts
});
```

### Python

```python
import asyncio
import websockets
import json

class FridayWebSocket:
    def __init__(self, url: str, token: str = None, api_key: str = None):
        self.url = url
        self.token = token
        self.api_key = api_key
        self.subscriptions = set()
        self.handlers = {}

    async def connect(self):
        auth = ""
        if self.token:
            auth = f"?token={self.token}"
        elif self.api_key:
            auth = f"?api_key={self.api_key}"
        
        self.ws = await websockets.connect(f"{self.url}{auth}")
        print("Connected to F.R.I.D.A.Y. WebSocket")
        
        asyncio.create_task(self.message_loop())

    async def subscribe(self, channels):
        message = {
            "type": "subscribe",
            "payload": {"channels": channels}
        }
        await self.ws.send(json.dumps(message))
        self.subscriptions.update(channels)

    def on(self, channel: str, handler):
        self.handlers[channel] = handler

    async def message_loop(self):
        try:
            async for message in self.ws:
                data = json.loads(message)
                await self.handle_message(data)
        except websockets.exceptions.ConnectionClosed:
            print("WebSocket connection closed")
            # Implement reconnection logic

    async def handle_message(self, message):
        if message["type"] in ["update", "event"]:
            channel = message["channel"]
            payload = message["payload"]
            
            if channel in self.handlers:
                await self.handlers[channel](payload)

# Usage
async def main():
    client = FridayWebSocket("ws://localhost:18789/ws", token=token)
    await client.connect()
    
    await client.subscribe(["metrics", "tasks", "security"])
    
    def on_metrics(metrics):
        print(f"Metrics: {metrics}")
    
    def on_tasks(event):
        print(f"Task event: {event}")
    
    client.on("metrics", on_metrics)
    client.on("tasks", on_tasks)
    
    # Keep running
    await asyncio.Future()

asyncio.run(main())
```

---

## Reconnection Strategy

### Recommended Reconnection Logic

1. **Immediate Reconnection**: Try to reconnect immediately after disconnection
2. **Exponential Backoff**: Increase delay between attempts (1s, 2s, 4s, 8s, max 30s)
3. **Jitter**: Add random variation to prevent thundering herd
4. **Max Attempts**: Limit reconnection attempts or implement manual refresh

### Connection Health Monitoring

```typescript
// Ping/Pong for connection health
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 30000);

// Handle pong responses
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'pong') {
    // Connection is healthy
  }
});
```

---

## Rate Limiting

WebSocket connections are subject to rate limiting:

- **Messages**: 100 messages per minute per connection
- **Subscriptions**: Maximum 10 channel subscriptions
- **Concurrent Connections**: 5 connections per user

Exceeding limits will result in connection termination.

---

## Security Considerations

- **Authentication Required**: All connections must authenticate
- **Authorization**: Users can only access channels they have permission for
- **Message Validation**: All messages are validated server-side
- **No Raw Commands**: Commands go through validation and authorization
- **Connection Logging**: All connections and messages are audited

---

## Related Documentation

- [REST API](rest-api.md)
- [Authentication Guide](../guides/authentication.md)
- [Security Model](../security/security-model.md)
- [Development Guide](../development/contributing.md)