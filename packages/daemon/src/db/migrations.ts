import type { Database as BunDatabase } from "bun:sqlite";

/**
 * Migration definition
 */
export interface Migration {
  version: number;
  name: string;
  up: (db: BunDatabase) => void;
  down?: (db: BunDatabase) => void;
}

/**
 * Migration manager for schema versioning
 */
export class MigrationManager {
  private db: BunDatabase;
  private migrations: Migration[];

  constructor(db: BunDatabase) {
    this.db = db;
    this.migrations = [];
    this.initMigrationsTable();
  }

  /**
   * Create migrations tracking table if it doesn't exist
   */
  private initMigrationsTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * Register a migration
   */
  register(migration: Migration): void {
    this.migrations.push(migration);
    // Keep migrations sorted by version
    this.migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Get current schema version
   */
  getCurrentVersion(): number {
    const stmt = this.db.prepare("SELECT MAX(version) as version FROM schema_migrations");
    const result = stmt.get() as { version: number | null };
    return result.version ?? 0;
  }

  /**
   * Get list of applied migrations
   */
  getAppliedMigrations(): number[] {
    const stmt = this.db.prepare("SELECT version FROM schema_migrations ORDER BY version");
    const rows = stmt.all() as { version: number }[];
    return rows.map((row) => row.version);
  }

  /**
   * Apply pending migrations
   */
  migrate(): void {
    const currentVersion = this.getCurrentVersion();
    const pendingMigrations = this.migrations.filter((m) => m.version > currentVersion);

    if (pendingMigrations.length === 0) {
      return;
    }

    for (const migration of pendingMigrations) {
      console.log(`Applying migration ${migration.version}: ${migration.name}`);

      try {
        migration.up(this.db);

        // Record migration
        const stmt = this.db.prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
        );
        stmt.run(migration.version, migration.name, Date.now());

        console.log(`Migration ${migration.version} applied successfully`);
      } catch (error) {
        console.error(`Migration ${migration.version} failed:`, error);
        throw error;
      }
    }
  }

  /**
   * Rollback migrations to a specific version
   */
  rollback(targetVersion: number): void {
    const currentVersion = this.getCurrentVersion();

    if (targetVersion >= currentVersion) {
      return;
    }

    const migrationsToRollback = this.migrations
      .filter((m) => m.version > targetVersion && m.version <= currentVersion)
      .reverse(); // Rollback in reverse order

    for (const migration of migrationsToRollback) {
      if (!migration.down) {
        throw new Error(
          `Migration ${migration.version} (${migration.name}) does not support rollback`
        );
      }

      console.log(`Rolling back migration ${migration.version}: ${migration.name}`);

      try {
        migration.down(this.db);

        // Remove migration record
        const stmt = this.db.prepare("DELETE FROM schema_migrations WHERE version = ?");
        stmt.run(migration.version);

        console.log(`Migration ${migration.version} rolled back successfully`);
      } catch (error) {
        console.error(`Rollback of migration ${migration.version} failed:`, error);
        throw error;
      }
    }
  }

  /**
   * Reset database to initial state (rollback all migrations)
   */
  reset(): void {
    this.rollback(0);
  }
}

/**
 * Example migration definitions
 *
 * Note: The initial schema is loaded via schema.sql, so migrations
 * are primarily for future schema changes after initial deployment.
 */

/**
 * Example: Add index for session timestamps
 */
export const migration001: Migration = {
  version: 1,
  name: "add_session_timestamp_index",
  up: (db) => {
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_sessions_created_at
      ON sessions(created_at DESC)
    `);
  },
  down: (db) => {
    db.run("DROP INDEX IF EXISTS idx_sessions_created_at");
  },
};

/**
 * Example: Add index for event timestamps
 */
export const migration002: Migration = {
  version: 2,
  name: "add_event_timestamp_index",
  up: (db) => {
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_events_ts
      ON events(ts DESC)
    `);
  },
  down: (db) => {
    db.run("DROP INDEX IF EXISTS idx_events_ts");
  },
};
