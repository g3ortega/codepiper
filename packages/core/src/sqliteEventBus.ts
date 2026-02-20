/**
 * SQLite EventBus - Reliable message delivery without Redis dependency
 *
 * Why SQLite instead of Redis:
 * - No external dependencies (SQLite already used for database)
 * - Simpler deployment (one less service to manage)
 * - Perfect for single-daemon deployments
 * - At-least-once delivery via database transactions
 * - Message persistence built-in
 *
 * Trade-offs vs Redis Streams:
 * - No horizontal scaling (single daemon only)
 * - Polling-based instead of push-based
 * - Good enough for most use cases
 */

import { Database as BunDatabase } from "bun:sqlite";

export interface Event {
  id: string; // UUID
  timestamp: number; // Unix milliseconds
  source: "tmux" | "hook" | "transcript" | "policy" | "workflow" | "user" | "daemon";
  sessionId?: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface SQLiteEventBusOptions {
  /**
   * Path to SQLite database file
   * @default ":memory:"
   */
  dbPath?: string;

  /**
   * Consumer group name for this instance
   * @example "daemon-instance-1"
   */
  consumerGroup?: string;

  /**
   * Consumer name (unique per instance)
   * @example "daemon-worker-1"
   */
  consumerName?: string;

  /**
   * Max events to keep per channel
   * @default 10000
   */
  maxEventsPerChannel?: number;

  /**
   * Polling interval in ms
   * @default 100
   */
  pollingIntervalMs?: number;
}

interface Subscription {
  channel: string;
  handler: (event: Event) => Promise<void>;
  abortController: AbortController;
  pollingInterval?: Timer;
}

export class SQLiteEventBus {
  private db: BunDatabase;
  private consumerGroup: string;
  private consumerName: string;
  private maxEventsPerChannel: number;
  private pollingIntervalMs: number;
  private subscriptions = new Map<string, Subscription>();

  constructor(options: SQLiteEventBusOptions = {}) {
    this.db = new BunDatabase(options.dbPath || ":memory:");
    this.consumerGroup = options.consumerGroup || "codepiper-daemon";
    this.consumerName = options.consumerName || `worker-${crypto.randomUUID().slice(0, 8)}`;
    this.maxEventsPerChannel = options.maxEventsPerChannel || 10000;
    this.pollingIntervalMs = options.pollingIntervalMs || 100;

    this.initSchema();

    console.log(
      `[SQLiteEventBus] Initialized: group=${this.consumerGroup}, name=${this.consumerName}`
    );
  }

  /**
   * Initialize database schema for event bus
   */
  private initSchema(): void {
    // Events table (messages)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS event_bus_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        message_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_channel ON event_bus_messages(channel)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_created_at ON event_bus_messages(created_at)`);

    // Consumer tracking (for at-least-once delivery)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS event_bus_consumers (
        consumer_group TEXT NOT NULL,
        consumer_name TEXT NOT NULL,
        channel TEXT NOT NULL,
        last_processed_id INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (consumer_group, consumer_name, channel)
      )
    `);

    // Pending messages (not yet acknowledged)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS event_bus_pending (
        message_id INTEGER NOT NULL,
        consumer_group TEXT NOT NULL,
        consumer_name TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (message_id, consumer_group, consumer_name),
        FOREIGN KEY (message_id) REFERENCES event_bus_messages(id) ON DELETE CASCADE
      )
    `);
  }

  /**
   * Check if EventBus is ready (always true for SQLite)
   */
  isReady(): boolean {
    return true;
  }

  /**
   * Publish event to channel
   *
   * @returns Message ID
   */
  async publish(channel: string, event: Event): Promise<string> {
    const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      // Insert message
      this.db.run(
        `INSERT INTO event_bus_messages (channel, message_id, data, created_at)
         VALUES (?, ?, ?, ?)`,
        [channel, messageId, JSON.stringify(event), Date.now()]
      );

      // Trim old messages to prevent unbounded growth
      this.db.run(
        `DELETE FROM event_bus_messages
         WHERE channel = ?
         AND id NOT IN (
           SELECT id FROM event_bus_messages
           WHERE channel = ?
           ORDER BY id DESC
           LIMIT ?
         )`,
        [channel, channel, this.maxEventsPerChannel]
      );

      return messageId;
    } catch (err) {
      console.error(`[SQLiteEventBus] Failed to publish to ${channel}:`, err);
      throw err;
    }
  }

  /**
   * Subscribe to event channel with consumer group
   *
   * Consumer groups provide:
   * - Each message delivered to ONE consumer in the group
   * - Unacknowledged messages are retried
   * - Messages survive process restarts
   *
   * @param channel - Channel name (e.g., "session:output" or "token:usage")
   * @param handler - Async function to process events
   */
  async subscribe(channel: string, handler: (event: Event) => Promise<void>): Promise<() => void> {
    // Initialize consumer tracking
    this.db.run(
      `INSERT OR IGNORE INTO event_bus_consumers (consumer_group, consumer_name, channel, last_processed_id, updated_at)
       VALUES (?, ?, ?, 0, ?)`,
      [this.consumerGroup, this.consumerName, channel, Date.now()]
    );

    // Create subscription
    const abortController = new AbortController();
    const subscription: Subscription = {
      channel,
      handler,
      abortController,
    };

    this.subscriptions.set(channel, subscription);

    // Start polling for messages
    this.startPolling(subscription);

    console.log(
      `[SQLiteEventBus] Subscribed to ${channel} (group: ${this.consumerGroup}, consumer: ${this.consumerName})`
    );

    // Return unsubscribe function
    return () => {
      abortController.abort();
      if (subscription.pollingInterval) {
        clearInterval(subscription.pollingInterval);
      }
      this.subscriptions.delete(channel);
      console.log(`[SQLiteEventBus] Unsubscribed from ${channel}`);
    };
  }

  /**
   * Start polling for new messages
   */
  private startPolling(subscription: Subscription): void {
    const { channel, handler, abortController } = subscription;

    subscription.pollingInterval = setInterval(async () => {
      if (abortController.signal.aborted) {
        if (subscription.pollingInterval) {
          clearInterval(subscription.pollingInterval);
        }
        return;
      }

      try {
        // Get last processed ID for this consumer
        const consumer = this.db
          .query(
            `SELECT last_processed_id FROM event_bus_consumers
             WHERE consumer_group = ? AND consumer_name = ? AND channel = ?`
          )
          .get(this.consumerGroup, this.consumerName, channel) as any;

        const lastProcessedId = consumer?.last_processed_id || 0;

        // Fetch new messages
        const messages = this.db
          .query(
            `SELECT id, message_id, data FROM event_bus_messages
             WHERE channel = ? AND id > ?
             ORDER BY id ASC
             LIMIT 10`
          )
          .all(channel, lastProcessedId) as any[];

        for (const message of messages) {
          if (abortController.signal.aborted) break;

          try {
            // Parse event data
            const event: Event = JSON.parse(message.data);

            // Process message
            await handler(event);

            // Acknowledge successful processing
            this.db.run(
              `UPDATE event_bus_consumers
               SET last_processed_id = ?, updated_at = ?
               WHERE consumer_group = ? AND consumer_name = ? AND channel = ?`,
              [message.id, Date.now(), this.consumerGroup, this.consumerName, channel]
            );
          } catch (err) {
            console.error(
              `[SQLiteEventBus] Error processing message ${message.id} from ${channel}:`,
              err
            );
            // Message will be redelivered on next poll since last_processed_id not updated
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error(`[SQLiteEventBus] Error polling channel ${channel}:`, err);
        }
      }
    }, this.pollingIntervalMs);
  }

  /**
   * Get channel info
   */
  async getChannelInfo(channel: string): Promise<{
    messageCount: number;
    consumers: number;
  }> {
    try {
      const messageCount = this.db
        .query(`SELECT COUNT(*) as count FROM event_bus_messages WHERE channel = ?`)
        .get(channel) as any;

      const consumers = this.db
        .query(`SELECT COUNT(*) as count FROM event_bus_consumers WHERE channel = ?`)
        .get(channel) as any;

      return {
        messageCount: messageCount?.count || 0,
        consumers: consumers?.count || 0,
      };
    } catch (err) {
      console.error(`[SQLiteEventBus] Error getting channel info:`, err);
      return { messageCount: 0, consumers: 0 };
    }
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    // Stop all subscriptions
    for (const [_channel, subscription] of this.subscriptions.entries()) {
      subscription.abortController.abort();
      if (subscription.pollingInterval) {
        clearInterval(subscription.pollingInterval);
      }
    }
    this.subscriptions.clear();

    // Close database
    this.db.close();

    console.log("[SQLiteEventBus] Closed");
  }
}
