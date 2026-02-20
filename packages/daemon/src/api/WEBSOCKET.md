# WebSocket Streaming API

The CodePiper daemon provides real-time event streaming via WebSocket connections. This allows clients to subscribe to session events, PTY output, and session state changes without polling.

## Connecting

Connect to the WebSocket endpoint at `/ws`:

```javascript
// Unix socket
const ws = new WebSocket('ws+unix:///path/to/codepiper.sock:/ws');

// TCP (if daemon is configured for TCP)
const ws = new WebSocket('ws://localhost:8080/ws');
```

## Message Format

### Client → Server

All client messages use this JSON format:

```json
{
  "op": "hello" | "subscribe" | "unsubscribe" | "pty_input" | "pty_key" | "pty_paste",
  "version": 1,
  "supports": {
    "ptyPatch": true,
    "ptyBinary": true,
    "ptyPaste": true
  },
  "topic": "session:<id>:events" | "session:<id>:pty" | "sessions" | "notifications",
  "sinceSeq": 0,
  "requestId": "abc123"
}
```

Input dispatch control responses may emit success acknowledgements:

```json
{
  "op": "pty_input_ack",
  "sessionId": "abc123",
  "requestId": "abc123"
}
```

```json
{
  "op": "pty_key_ack",
  "sessionId": "abc123",
  "requestId": "abc123"
}
```

```json
{
  "op": "pty_paste_ack",
  "sessionId": "abc123",
  "requestId": "abc123"
}
```

Input dispatch failures may emit control errors:

```json
{
  "op": "pty_input_error",
  "sessionId": "abc123",
  "requestId": "abc123",
  "error": "Failed to deliver PTY input",
  "code": "policy_blocked",
  "status": 403,
  "policyAction": "deny"
}
```

```json
{
  "op": "pty_key_error",
  "sessionId": "abc123",
  "requestId": "abc123",
  "error": "Failed to deliver PTY key input",
  "code": "policy_blocked",
  "status": 409,
  "policyAction": "ask"
}
```

```json
{
  "op": "pty_paste_error",
  "sessionId": "abc123",
  "requestId": "abc123",
  "error": "Failed to deliver PTY paste input",
  "code": "policy_blocked",
  "status": 403,
  "policyAction": "deny"
}
```

For policy-preflight blocks (used by no-hook providers like Codex), `*_error` may include:

- `code`: `"policy_blocked"`
- `status`: HTTP-style status (`403` deny, `409` explicit ask without interactive approval support)
- `policyAction`: policy engine action (`allow` | `deny` | `ask`)
- `provider`: provider ID (for diagnostics)

`hello` is optional but recommended immediately after connect. It enables protocol-version negotiation
and client capability negotiation (`supports`).
When `op="hello"`, `version` can be provided; if provided and unsupported, the server rejects the message.

`sinceSeq` is optional and only used for `session:<id>:pty` subscriptions.
When provided, the server replays buffered PTY frames with `seq > sinceSeq`.

For `pty_input`, send:

```json
{
  "op": "pty_input",
  "sessionId": "abc123",
  "data": "echo hello\\n",
  "requestId": "abc123"
}
```

`requestId` is optional but recommended. If provided, daemon `pty_input_error` responses echo the same `requestId` so the client can correlate and retry exactly the failed request.
On successful dispatch, daemon emits `pty_input_ack` with the same `requestId`.

For `pty_key`, send:

```json
{
  "op": "pty_key",
  "sessionId": "abc123",
  "key": "enter",
  "requestId": "abc123"
}
```

`requestId` is optional but recommended. If provided, daemon `pty_key_error` responses echo the same `requestId`.
On successful dispatch, daemon emits `pty_key_ack` with the same `requestId`.

For chunked `pty_paste`, send:

```json
{
  "op": "pty_paste",
  "sessionId": "abc123",
  "requestId": "paste-req-1",
  "chunkIndex": 0,
  "chunkCount": 3,
  "data": "first chunk"
}
```

`pty_paste` chunks must arrive in order (`chunkIndex` 0..`chunkCount-1`) and use the same
`requestId` per logical paste. The daemon reassembles and dispatches atomically once all chunks
arrive, then emits `pty_paste_ack` (or `pty_paste_error` on failure). Logical paste payloads are
currently capped at 2MB.

`pty_paste` availability is controlled by daemon settings (`settings.terminalFeatures.wsPtyPasteEnabled`)
and can also be hard-disabled by `CODEPIPER_WS_PTY_PASTE=0`.

### Inbound Rate Limits

Inbound message limits are enforced per connection over a rolling 10s window and are segmented
by operation class:

- Control operations (`hello`, `subscribe`, `unsubscribe`): 120 messages / 10s
- `pty_input`: 600 messages / 10s
- `pty_key`: 2000 messages / 10s
- `pty_paste` chunks: 600 messages / 10s

When a quota is exceeded, daemon closes the socket with code `1008` and reason `Rate limit exceeded`.
This segmentation prevents high-frequency keyboard traffic from consuming control-operation budget.

### Outbound Backpressure Behavior

Daemon uses Bun's WebSocket backpressure signal (`send()` returning `-1`) together with `drain`
to avoid burst disconnects:

- Once a client is backpressured, new outbound frames are queued per-connection.
- Queue is bounded (`WS_MAX_PENDING_OUTBOUND_MESSAGES=256`, `WS_MAX_PENDING_OUTBOUND_BYTES=2MB`).
- On `drain`, queued frames are flushed.
- If queue overflows or sustained backpressure persists, daemon closes with code `1013`.

### Server → Client

All server messages include a `topic` plus topic-specific payload fields.

```json
{
  "topic": "<topic-name>",
  "...": "topic-specific fields"
}
```

Control messages (no `topic`) are also sent for protocol negotiation and input dispatch status (`*_ack` / `*_error`):

```json
{
  "op": "hello_ack",
  "version": 1,
  "features": {
    "ptyReplay": true,
    "ptyPatch": false,
    "ptyBinary": false,
    "ptyPaste": true
  },
  "negotiated": {
    "ptyPatch": false,
    "ptyBinary": false,
    "ptyPaste": true
  }
}
```

## Topics

### `session:<session-id>:events`

Receive structured events (hooks, transcript, statusline) for a specific session.

**Subscribe:**
```javascript
ws.send(JSON.stringify({
  op: "subscribe",
  topic: "session:abc123:events"
}));
```

**Events received:**
```json
{
  "topic": "session:abc123:events",
  "data": {
    "sessionId": "abc123",
    "type": "SessionStart" | "Notification" | "PermissionRequest" | "Stop",
    "timestamp": "YYYY-MM-DDTHH:mm:ss.sssZ",
    "payload": { ... }
  }
}
```

### `session:<session-id>:pty`

Receive raw PTY output for a specific session.

**Subscribe:**
```javascript
ws.send(JSON.stringify({
  op: "subscribe",
  topic: "session:abc123:pty",
  sinceSeq: 41
}));
```

**Events received:**
```json
{
  "topic": "session:abc123:pty",
  "type": "pty_output",
  "data": "Hello from PTY\n",
  "seq": 42,
  "cursor": { "x": 14, "y": 23, "visible": true }
}
```

### `notifications`

Receive global notification-domain updates used by inbox/badge clients.

**Subscribe:**
```javascript
ws.send(JSON.stringify({
  op: "subscribe",
  topic: "notifications"
}));
```

**Events received:**
```json
{
  "topic": "notifications",
  "type": "notification_created" | "notification_read" | "notification_counts_updated",
  "data": {
    "...": "notification payload"
  }
}
```

`cursor` is optional and reflects tmux cursor position/visibility for the rendered pane.
Clients should treat it as best-effort metadata and continue rendering even when absent.

When PTY patch mode is enabled (`CODEPIPER_WS_PTY_PATCH=1`), the server may emit:

```json
{
  "topic": "session:abc123:pty",
  "type": "pty_patch",
  "baseSeq": 42,
  "seq": 43,
  "start": 120,
  "deleteCount": 5,
  "data": "new text",
  "cursor": { "x": 18, "y": 23, "visible": true }
}
```

Patch frames are incremental updates to the previous frame (`baseSeq`) and are only
sent when the patch payload is smaller than a full `pty_output` frame.
They are emitted only for clients that negotiated `ptyPatch=true` in `hello`.

When binary PTY transport is enabled (`CODEPIPER_WS_PTY_BINARY=1`) and negotiated via
`supports.ptyBinary=true`, PTY frames may be sent as binary WebSocket frames instead of JSON text.
The binary payload preserves the same logical fields (`topic`, `type`, `seq`, etc.) and is currently
applied to live PTY streaming frames.
Replay frames (`sinceSeq`) remain canonical JSON `pty_output` payloads for deterministic recovery
across mixed client capabilities.

`seq` is a per-session, monotonically increasing frame number that can be
used by clients to drop stale frames after reconnects or race conditions.

### `sessions`

Receive session state changes (created, status updates, stopped).

**Subscribe:**
```javascript
ws.send(JSON.stringify({
  op: "subscribe",
  topic: "sessions"
}));
```

**Events received:**
```json
{
  "topic": "sessions",
  "type": "session_updated",
  "session": {
    "id": "abc123",
    "provider": "claude-code",
    "cwd": "/path/to/project",
    "status": "RUNNING",
    "createdAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
    "updatedAt": "YYYY-MM-DDTHH:mm:ss.sssZ",
    "pid": 12345
  }
}
```

## Unsubscribing

To stop receiving events for a topic:

```javascript
ws.send(JSON.stringify({
  op: "unsubscribe",
  topic: "session:abc123:events"
}));
```

## Example: Full Session Monitoring

```javascript
const ws = new WebSocket('ws+unix:///tmp/codepiper.sock:/ws');

ws.onopen = () => {
  console.log('Connected to CodePiper daemon');

  // Optional protocol negotiation
  ws.send(JSON.stringify({
    op: "hello",
    version: 1,
    supports: { ptyPatch: true, ptyBinary: true, ptyPaste: true }
  }));

  // Subscribe to session events
  ws.send(JSON.stringify({
    op: "subscribe",
    topic: "session:abc123:events"
  }));

  // Subscribe to PTY output
  ws.send(JSON.stringify({
    op: "subscribe",
    topic: "session:abc123:pty"
  }));

  // Subscribe to all session changes
  ws.send(JSON.stringify({
    op: "subscribe",
    topic: "sessions"
  }));
};

ws.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    // Optional: decode binary PTY frame when ptyBinary is negotiated
    return;
  }
  const message = JSON.parse(event.data);

  if (message.topic === 'session:abc123:events') {
    console.log('Session event:', message.data.type, message.data.payload);
  }

  if (message.topic === 'session:abc123:pty') {
    if (message.type === 'pty_output') {
      process.stdout.write(message.data);
    }
  }

  if (message.topic === 'sessions') {
    console.log('Session state changed:', message.type);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('Disconnected from CodePiper daemon');
};
```

## Error Handling

If an invalid message is sent, the server will respond with an error:

```json
{
  "error": "Invalid message: missing 'op' field"
}
```

Common errors:
- `"Invalid message: missing 'op' field"` - Message must include `op` field
- `"Invalid message: missing 'topic' field"` - Subscribe/unsubscribe requires `topic`
- `"Invalid topic format: <topic>"` - Topic doesn't match valid patterns
- `"Unknown operation: <op>"` - Invalid operation (must be `hello`, `subscribe`, `unsubscribe`, `pty_input`, `pty_key`, or `pty_paste`)
- `"Unsupported protocol version: <n> (server=1)"` - Client requested an unsupported protocol version
- `"Invalid message: 'requestId' ..."` - Optional `requestId` must be 1-128 chars matching `[a-zA-Z0-9_-]+`

## Topic Validation

Topics must match one of these patterns:
- `session:<session-id>:events` - Session ID must be alphanumeric with hyphens
- `session:<session-id>:pty` - Session ID must be alphanumeric with hyphens
- `sessions` - Exact match

Invalid examples:
- `session:abc:invalid` - Invalid event type
- `session:with spaces:events` - Invalid session ID format
- `random-topic` - Unknown topic pattern

## Implementation Notes

### Multiple Subscriptions

A single WebSocket connection can subscribe to multiple topics:

```javascript
ws.send(JSON.stringify({ op: "subscribe", topic: "session:abc123:events" }));
ws.send(JSON.stringify({ op: "subscribe", topic: "session:def456:events" }));
ws.send(JSON.stringify({ op: "subscribe", topic: "sessions" }));
```

### Broadcasting

Events are broadcast to all subscribed clients:
- Multiple clients can subscribe to the same topic
- Each client receives a copy of every event for topics they're subscribed to
- Events are filtered by topic before sending (efficient)

### Connection Cleanup

When a WebSocket connection closes:
- All subscriptions for that connection are automatically removed
- No cleanup action required from client
- Connection can be re-established at any time

### Thread Safety

The WebSocket manager is designed for concurrent access:
- Multiple clients can connect simultaneously
- Event broadcasting is atomic
- No race conditions when subscribing/unsubscribing

## Integration with Daemon

The WebSocket manager integrates with the daemon's event bus:

```typescript
// When provider emits an event
eventBus.emit("event", {
  sessionId: "abc123",
  type: "SessionStart",
  timestamp: new Date(),
  payload: { cwd: "/test" }
});

// WebSocket manager automatically broadcasts to subscribers of:
// - topic: "session:abc123:events"
```

Manual broadcasting is also available:

```typescript
// Broadcast PTY data
wsManager.broadcastPtyData("abc123", "Hello from PTY\n");

// Broadcast session state change
wsManager.broadcastSessionChange({
  id: "abc123",
  status: "RUNNING",
  // ... other session fields
});
```
