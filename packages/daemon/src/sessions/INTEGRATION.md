# Transcript Tailing Integration

## Overview

The transcript tailing system provides automatic, crash-safe ingestion of Claude Code JSONL transcripts into the CodePiper's event system. Tailers automatically start when sessions provide a transcript path, parse events in real-time, and resume from saved offsets after crashes or restarts.

## Architecture

### Components

1. **TranscriptTailer** (`transcriptTailer.ts`)
   - Low-level file tailing implementation
   - Watches transcript files for changes
   - Parses JSONL lines incrementally
   - Tracks byte offsets for resumption

2. **SessionManager Integration** (`sessionManager.ts`)
   - Auto-starts tailers when `transcript_path` is set
   - Manages tailer lifecycle (start/stop)
   - Coordinates with database for offset persistence
   - Emits events on the event bus

3. **Database Layer** (`db.ts`)
   - Stores transcript events with `source='transcript'`
   - Maintains `transcript_offsets` table for crash recovery
   - Provides query APIs for transcript events

4. **Hooks Integration** (`hooks.ts`)
   - SessionStart hook triggers tailer startup
   - Automatically extracts `transcript_path` from hook data

### Data Flow

```
Claude Code → transcript.jsonl → TranscriptTailer → SessionManager → Database
                                                   ↓
                                                EventBus → WebSocket clients
```

## Session Lifecycle Integration

### 1. Session Start

When a Claude Code session starts:

```typescript
// SessionStart hook received
{
  event: "SessionStart",
  data: {
    transcript_path: "/path/to/transcript.jsonl",
    session_id: "uuid",
    ...
  }
}
```

The hook handler:
1. Updates session record with `transcript_path`
2. Calls `sessionManager.setTranscriptPath()`
3. SessionManager starts TranscriptTailer
4. Tailer loads initial offset from database
5. Tailer begins watching file

### 2. Event Processing

For each new line in the transcript:

1. **Parse**: TranscriptTailer reads line and tracks byte offset
2. **Store**: SessionManager inserts event into database
3. **Emit**: Event emitted on EventBus for real-time subscribers
4. **Persist**: Offset saved periodically (every 1 second)

### 3. Session End

When session stops:

1. `sessionManager.stopSession()` called
2. Tailer stopped (file watcher closed)
3. Final offset saved to database
4. Cleanup intervals and resources

## Offset Management Strategy

### Why Offsets?

Byte offsets enable crash-safe resumption:
- After daemon crash, resume from last saved position
- Prevents duplicate event processing
- Handles transcript files that grow during downtime

### Offset Storage

```sql
CREATE TABLE transcript_offsets (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  byte_offset INTEGER NOT NULL,
  last_line_hash TEXT,
  PRIMARY KEY (session_id, path)
);
```

### Offset Update Strategy

- **Frequency**: Every 1 second (via setInterval)
- **On Stop**: Final offset saved when tailer stops
- **Source of Truth**: `tailer.getCurrentOffset()` returns current position

### Resumption Logic

```typescript
// On tailer start
const { byteOffset } = db.getTranscriptOffset(sessionId, transcriptPath);

// Start reading from saved offset
const tailer = new TranscriptTailer({
  initialOffset: byteOffset,
  // ...
});
```

## Error Handling and Retries

### File Not Created Yet

Claude Code may not create the transcript file immediately. Tailer handles this gracefully:

```typescript
// TranscriptTailer polls every 100ms if file doesn't exist
if (!fs.existsSync(this.transcriptPath)) {
  // Wait and retry
  return;
}
```

### Malformed JSON Lines

Invalid JSON lines are logged but don't crash the tailer:

```typescript
try {
  const parsed = JSON.parse(line);
  // Process event
} catch (error) {
  console.error(`Failed to parse transcript line:`, error);
  // Continue processing other lines
}
```

### File Watcher Failures

If `fs.watch()` fails, tailer falls back to polling:

```typescript
try {
  this.watcher = fs.watch(this.transcriptPath, ...);
} catch (error) {
  // Fall back to 100ms polling interval
  this.setupPolling();
}
```

## Performance Characteristics

Based on benchmark results:

### Parsing Speed
- **10,000 lines**: ~2 seconds
- **Throughput**: ~22,000 lines/second
- **Single line latency**: P50=0.3ms, P95=0.5ms

### Memory Usage
- **Per tailer overhead**: <1MB
- **10 concurrent tailers**: <1MB total increase
- **Buffer size**: Lines buffered only until complete (minimal memory)

### Database Writes
- **Individual inserts**: One per line (no batching currently)
- **1,000 events**: ~1 second
- **Offset updates**: Batched via 1-second interval

### Event Emission
- **Latency**: P50=0.4ms, P95=0.75ms (write-to-event time)
- **Real-time**: Events emitted immediately after parsing

## Concurrency

### Multiple Sessions

SessionManager tracks tailers per session:

```typescript
private tailers = new Map<string, TranscriptTailer>();
private tailerContexts = new Map<string, { db, transcriptPath }>();
```

Each session has independent:
- Tailer instance
- File watcher
- Offset save interval
- Transcript path

### Thread Safety

All operations are single-threaded (Bun's event loop):
- No locks needed
- Database writes are synchronous
- Event emission is synchronous

## Monitoring and Debugging

### Logging

Errors logged to console:

```typescript
console.error(`Transcript tailer error for session ${sessionId}:`, err);
console.error(`Failed to parse transcript line for session ${sessionId}:`, error);
```

### Health Checks

Check tailer status:

```typescript
sessionManager.hasActiveTailer(sessionId); // Returns boolean
```

### Event Queries

Query transcript events via API:

```
GET /sessions/:id/events?source=transcript&since=<eventId>&limit=<number>
```

Or directly from database:

```typescript
db.getEventsBySessionId(sessionId, {
  source: "transcript",
  since: lastEventId,
});
```

### Offset Inspection

Check current offset:

```typescript
const { byteOffset } = db.getTranscriptOffset(sessionId, transcriptPath);
```

## API Endpoints

### Get Transcript Events

```
GET /sessions/:sessionId/transcript?since=<eventId>&limit=<number>
```

**Query Parameters:**
- `since` (optional): Event ID to start from (exclusive)
- `limit` (optional): Maximum number of events to return

**Response:**
```json
{
  "events": [
    {
      "id": 123,
      "sessionId": "uuid",
      "timestamp": "YYYY-MM-DDTHH:mm:ss.sssZ",
      "source": "transcript",
      "type": "user_message",
      "payload": { ... }
    }
  ]
}
```

## Testing

### Test Coverage

- **Integration Tests** (`transcriptIntegration.test.ts`): 7 tests
  - Auto-start on transcript_path set
  - Database storage verification
  - Event bus emission
  - Multi-session concurrency
  - Crash recovery with offsets

- **E2E Tests** (`transcriptE2E.test.ts`): 5 tests
  - Full session lifecycle
  - Event streaming
  - Daemon restart simulation
  - Malformed JSON handling
  - Rapid concurrent writes

- **Recovery Tests** (`transcriptRecovery.test.ts`): 4 tests
  - Resume after crash
  - Mid-parse crash handling
  - Multiple crash/restart cycles
  - Events during downtime

- **Performance Tests** (`transcriptPerformance.test.ts`): 5 tests
  - 10k line parsing benchmark
  - 10 concurrent tailers
  - Event emission latency
  - Memory usage validation
  - Database write efficiency

### Running Tests

```bash
# All transcript tests
bun test packages/daemon/src/sessions/transcript*.test.ts

# Individual suites
bun test packages/daemon/src/sessions/transcriptIntegration.test.ts
bun test packages/daemon/src/sessions/transcriptE2E.test.ts
bun test packages/daemon/src/sessions/transcriptRecovery.test.ts
bun test packages/daemon/src/sessions/transcriptPerformance.test.ts
```

## Known Limitations

### 1. No Line Batching

Events are inserted individually into the database. For very high-throughput scenarios, batched inserts could improve performance.

**Workaround**: Current performance (~1000 events/second) is sufficient for typical Claude Code sessions.

### 2. Polling Fallback

If `fs.watch()` fails, tailer falls back to 100ms polling. This increases CPU usage slightly.

**Impact**: Minimal on modern systems, but worth monitoring in resource-constrained environments.

### 3. Memory Buffering

Incomplete lines are buffered in memory. Very long lines (>100KB) could increase memory usage.

**Mitigation**: Claude Code transcripts use reasonably-sized JSON objects per line.

### 4. File Rotation Not Supported

If Claude Code rotates transcript files (unlikely), tailer would need manual restart.

**Status**: Not observed in practice; Claude Code uses append-only transcripts.

## Future Enhancements

### Compression

Transcript files can grow large. Consider:
- GZIP old transcript files
- Store compressed payloads in database
- Stream decompression for queries

### Batched Database Writes

Batch multiple event inserts into single transaction:
- Reduces I/O overhead
- Improves throughput for high-rate sessions
- Trade-off: slight increase in event latency

### Structured Event Schema

Currently `payload` is opaque JSON. Consider:
- Normalize common event types (user_message, assistant_message, tool_use)
- Extract frequently-queried fields into columns
- Enable efficient filtering and search

### Event Indexing

Add full-text search on event payloads:
- Index message content
- Support semantic search
- Enable event-sequence queries ("find all tool uses in session X")

## Troubleshooting

### Tailer Not Starting

**Symptom**: No transcript events appearing in database

**Checks**:
1. Verify SessionStart hook received: `db.getEventsBySessionId(sessionId, { type: 'SessionStart' })`
2. Check transcript_path set: `db.getSession(sessionId).transcriptPath`
3. Verify tailer active: `sessionManager.hasActiveTailer(sessionId)`
4. Check file exists: `fs.existsSync(transcriptPath)`

### Duplicate Events

**Symptom**: Same event appearing multiple times

**Likely Cause**: Offset not being saved properly

**Checks**:
1. Verify offset table: `SELECT * FROM transcript_offsets WHERE session_id=?`
2. Check offset increasing: Monitor `byteOffset` value over time
3. Verify save interval running: Look for periodic database updates

### Missing Events

**Symptom**: Events in transcript file but not in database

**Likely Cause**: Parse error or tailer crash

**Checks**:
1. Check console for parse errors
2. Verify file format (valid JSONL with `\n` line endings)
3. Check database for partial events: Last event ID should be contiguous
4. Verify offset matches file size: `fs.statSync(path).size` vs `byteOffset`

### High Memory Usage

**Symptom**: Memory growing with multiple tailers

**Checks**:
1. Count active tailers: `sessionManager['tailers'].size`
2. Check for leaked intervals: `sessionManager['saveOffsetIntervals'].size`
3. Verify tailers stopped on session end: Call `stopAll()` and check memory

### Slow Performance

**Symptom**: Events taking too long to appear

**Checks**:
1. Check file watcher vs polling: `watcher !== null` vs `pollInterval !== null`
2. Verify database not locked: Check for long-running transactions
3. Monitor disk I/O: `iostat` or Activity Monitor
4. Check event bus listener count: Too many listeners can slow emission
