# Database Layer

SQLite-based persistence layer for the CodePiper daemon.

## Overview

The database layer provides crash-safe storage for:
- **Sessions**: CLI session metadata and state
- **Events**: Structured events from various sources (PTY, hooks, transcript, statusline)
- **Transcript Offsets**: Byte offsets for resumable transcript tailing

## Architecture

### Design Principles

1. **Interface-based**: All operations go through `IDatabase` interface for future swappability
2. **Type-safe**: Full TypeScript types from core package
3. **Crash-safe**: Atomic operations with transaction support
4. **Migration-friendly**: Schema versioning via `MigrationManager`

### Schema

**sessions**
- Stores session lifecycle state (STARTING → RUNNING → STOPPED)
- PTY dimensions (cols/rows) for attachment
- Provider-specific metadata as JSON
- Indexed by status and provider for fast filtering

**events**
- All events share common structure: sessionId, timestamp, source, type, payload
- Source types: `pty`, `hook`, `transcript`, `statusline`
- Indexed by session_id for efficient querying
- Supports "since" queries for polling/streaming

**transcript_offsets**
- Enables crash-safe transcript tailing
- Composite primary key: (session_id, path)
- Stores byte offset and optional line hash for deduplication

## Usage

### Basic Operations

```typescript
import { Database } from "@codepiper/daemon/db";

// Initialize database
const db = new Database("/path/to/codepiper.db");
await db.init();

// Create session
db.createSession({
  id: "session-123",
  provider: "claude-code",
  cwd: "/workspace/project",
  status: "STARTING",
  pid: 12345,
  ptyRows: 30,
  ptyCols: 120,
});

// Update session
db.updateSession("session-123", {
  status: "RUNNING",
  transcriptPath: "/tmp/transcript.jsonl",
});

// Query sessions
const sessions = db.listSessions({ status: "RUNNING" });
const session = db.getSession("session-123");

// Insert events
const eventId = db.insertEvent({
  sessionId: "session-123",
  source: "hook",
  type: "SessionStart",
  payload: { model: "claude-3-5-sonnet" },
});

// Query events
const events = db.getEventsBySessionId("session-123", {
  since: eventId,
  limit: 10,
  source: "hook",
});

// Manage transcript offsets
db.updateTranscriptOffset("session-123", "/tmp/transcript.jsonl", {
  byteOffset: 1024,
  lastLineHash: "abc123",
});

const offset = db.getTranscriptOffset("session-123", "/tmp/transcript.jsonl");
```

### Migrations

```typescript
import { Database } from "@codepiper/daemon/db";
import { MigrationManager } from "@codepiper/daemon/db/migrations";

const db = new Database("/path/to/codepiper.db");
await db.init();

const migrationManager = new MigrationManager(db["db"]);
migrationManager.register(migration001);
migrationManager.register(migration002);

// Apply pending migrations
migrationManager.migrate();

// Rollback to specific version
migrationManager.rollback(1);
```

### Custom Migrations

```typescript
import type { Migration } from "@codepiper/daemon/db/migrations";

const myMigration: Migration = {
  version: 3,
  name: "add_session_tags",
  up: (db) => {
    db.run(`ALTER TABLE sessions ADD COLUMN tags_json TEXT`);
  },
  down: (db) => {
    // Note: SQLite doesn't support DROP COLUMN easily
    // Consider recreating table or leaving column
    db.run(`UPDATE sessions SET tags_json = NULL`);
  },
};
```

## Testing

Run the full test suite:

```bash
bun test packages/daemon/src/db/db.test.ts
```

Run the example:

```bash
bun run packages/daemon/src/db/example.ts
```

### Test Coverage

- ✅ Database initialization and schema creation
- ✅ Session CRUD operations with all fields
- ✅ Session filtering by status and provider
- ✅ Event insertion with custom timestamps
- ✅ Event querying with filters (since, type, source, limit)
- ✅ Event isolation between sessions
- ✅ Transcript offset management
- ✅ Transcript offset isolation between sessions and paths
- ✅ Migration application and rollback

## Files

- `schema.sql` - Initial DDL with tables and indexes
- `db.ts` - Main `Database` class implementing `IDatabase`
- `db.test.ts` - Comprehensive test suite (28 tests)
- `migrations.ts` - Migration manager and example migrations
- `index.ts` - Public exports
- `example.ts` - Usage examples
- `README.md` - This file

## Performance Considerations

### Indexes

The schema includes strategic indexes for common query patterns:
- `idx_sessions_status` - Fast filtering by status
- `idx_sessions_provider` - Fast filtering by provider
- `idx_events_session_id` - Event queries by session
- `idx_events_session_id_id` - "Since" queries with composite index
- `idx_events_type` - Event type filtering
- `idx_events_source` - Event source filtering

### Best Practices

1. **Batch inserts**: Use transactions for bulk event insertion
2. **Limit queries**: Always use `limit` param for event queries in production
3. **Cleanup**: Delete old sessions and events to prevent unbounded growth
4. **Indexes**: Add indexes via migrations for new query patterns

## Future Enhancements

- [ ] Transaction API for atomic multi-operation updates
- [ ] Automatic session cleanup (TTL-based)
- [ ] Event retention policies
- [ ] Database compaction/vacuum scheduling
- [ ] Alternative backends (PostgreSQL, MySQL) via interface
- [ ] Read replicas for high-scale scenarios
