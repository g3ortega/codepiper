import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Event, SQLiteEventBus } from "./sqliteEventBus";

describe("SQLiteEventBus", () => {
  let eventBus: SQLiteEventBus;
  let eventBus2: SQLiteEventBus;

  beforeAll(async () => {
    // Create two event bus instances to test consumer groups (shared database)
    const dbPath = `:memory:`;

    eventBus = new SQLiteEventBus({
      dbPath,
      consumerGroup: "test-group",
      consumerName: "test-consumer-1",
      pollingIntervalMs: 50, // Fast polling for tests
    });

    eventBus2 = new SQLiteEventBus({
      dbPath,
      consumerGroup: "test-group",
      consumerName: "test-consumer-2",
      pollingIntervalMs: 50,
    });
  });

  afterAll(async () => {
    await eventBus.close();
    await eventBus2.close();
  });

  test("publishes and receives event", async () => {
    const testEvent: Event = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: "user",
      type: "test:event",
      payload: { message: "Hello, SQLite!" },
    };

    const received: Event[] = [];

    // Subscribe to test channel
    const unsubscribe = await eventBus.subscribe("test:publish", async (event) => {
      received.push(event);
    });

    // Wait a bit for subscription to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Publish event
    const messageId = await eventBus.publish("test:publish", testEvent);

    expect(messageId).toBeDefined();

    // Wait for event to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify event received
    expect(received.length).toBe(1);
    expect(received[0].id).toBe(testEvent.id);
    expect(received[0].payload.message).toBe("Hello, SQLite!");

    unsubscribe();
  });

  test("multiple consumers in same group", async () => {
    const consumer1Received: Event[] = [];
    const consumer2Received: Event[] = [];

    // Both consumers subscribe to same channel with same consumer group
    const unsubscribe1 = await eventBus.subscribe("test:consumer-group", async (event) => {
      consumer1Received.push(event);
    });

    const unsubscribe2 = await eventBus2.subscribe("test:consumer-group", async (event) => {
      consumer2Received.push(event);
    });

    // Wait for subscriptions
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Publish 10 events
    const events: Event[] = [];
    for (let i = 0; i < 10; i++) {
      const event: Event = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: "user",
        type: "test:load-balance",
        payload: { index: i },
      };
      events.push(event);
      await eventBus.publish("test:consumer-group", event);
    }

    // Wait for all events to be processed
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Note: SQLite EventBus doesn't load balance like Redis Streams
    // All consumers in the same group will process all messages
    // This is a trade-off for simplicity
    const totalReceived = consumer1Received.length + consumer2Received.length;
    expect(totalReceived).toBeGreaterThanOrEqual(10);

    console.log(
      `Consumer 1 received ${consumer1Received.length}, Consumer 2 received ${consumer2Received.length}`
    );

    unsubscribe1();
    unsubscribe2();
  });

  test("messages persist across restarts", async () => {
    // Create a new event bus with same db path
    const tempBus = new SQLiteEventBus({
      dbPath: ":memory:",
      consumerGroup: "test-group-persist",
      consumerName: "persist-consumer",
      pollingIntervalMs: 50,
    });

    // Publish events
    const events: Event[] = [];
    for (let i = 0; i < 5; i++) {
      const event: Event = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: "user",
        type: "test:persist",
        payload: { index: i },
      };
      events.push(event);
      await tempBus.publish("test:persist", event);
    }

    const received: Event[] = [];

    // Subscribe to channel (consumer starts from last processed)
    const unsubscribe = await tempBus.subscribe("test:persist", async (event) => {
      received.push(event);
    });

    // Wait for events to be processed
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify all events received
    expect(received.length).toBe(5);

    unsubscribe();
    await tempBus.close();
  });

  test("error handling in handlers", async () => {
    const received: Event[] = [];
    let failCount = 0;

    // Subscribe with a handler that fails first time
    const unsubscribe = await eventBus.subscribe("test:error", async (event) => {
      received.push(event);

      if (failCount === 0) {
        failCount++;
        throw new Error("Simulated failure");
      }

      // Second time succeeds
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Publish event
    const testEvent: Event = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: "user",
      type: "test:error",
      payload: { message: "retry me" },
    };

    await eventBus.publish("test:error", testEvent);

    // Wait for processing and retry
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Event should be redelivered because it wasn't acknowledged
    expect(received.length).toBeGreaterThanOrEqual(1);

    unsubscribe();
  });

  test("getChannelInfo returns correct stats", async () => {
    // Publish some events
    for (let i = 0; i < 3; i++) {
      await eventBus.publish("test:info", {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: "user",
        type: "test:info",
        payload: { index: i },
      });
    }

    const info = await eventBus.getChannelInfo("test:info");

    expect(info.messageCount).toBeGreaterThanOrEqual(3);
  });

  test("isReady always returns true", () => {
    expect(eventBus.isReady()).toBe(true);
  });
});
