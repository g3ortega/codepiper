/**
 * EventBusAdapter - Bridge between synchronous EventBus API and async SQLiteEventBus
 *
 * The daemon code expects synchronous emit/on API from the in-memory EventBus.
 * This adapter wraps SQLiteEventBus to provide the same interface.
 */

import { EventBus } from "./eventBus";
import type { Event, SQLiteEventBus } from "./sqliteEventBus";

type Handler<T> = (data: T) => void;
type Unsubscribe = () => void;

export class EventBusAdapter<
  EventMap extends Record<string, any> = Record<string, any>,
> extends EventBus<EventMap> {
  private unsubscribers = new Map<string, Unsubscribe[]>();
  private initPromises = new Map<string, Promise<void>>();

  constructor(private sqliteEventBus: SQLiteEventBus) {
    super();
  }

  /**
   * Subscribe to event channel
   *
   * Note: Subscription is async but we return unsubscribe function immediately.
   * The subscription will be active once the promise resolves (usually < 10ms).
   */
  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): Unsubscribe {
    const channel = String(event);

    // Start subscription asynchronously
    const initPromise = (async () => {
      try {
        const unsubscribe = await this.sqliteEventBus.subscribe(channel, async (event: Event) => {
          try {
            handler(event.payload as EventMap[K]);
          } catch (err) {
            console.error(`Error in event handler for ${channel}:`, err);
          }
        });

        // Store unsubscriber
        if (!this.unsubscribers.has(channel)) {
          this.unsubscribers.set(channel, []);
        }
        this.unsubscribers.get(channel)?.push(unsubscribe);
      } catch (err) {
        console.error(`Failed to subscribe to ${channel}:`, err);
      }
    })();

    this.initPromises.set(channel, initPromise);

    // Return immediate unsubscribe function
    return () => {
      // Wait for init to complete before unsubscribing
      initPromise
        .then(() => {
          const unsubscribers = this.unsubscribers.get(channel);
          if (unsubscribers && unsubscribers.length > 0) {
            const unsub = unsubscribers.pop();
            if (unsub) unsub();
          }
        })
        .catch((err) => {
          console.error(`Error during unsubscribe from ${channel}:`, err);
        });
    };
  }

  /**
   * Subscribe once - handler called only for first event
   */
  once<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): Unsubscribe {
    let unsubscribe: Unsubscribe;

    const wrappedHandler = (data: EventMap[K]) => {
      handler(data);
      if (unsubscribe) unsubscribe();
    };

    unsubscribe = this.on(event, wrappedHandler);
    return unsubscribe;
  }

  /**
   * Emit event to channel
   *
   * Note: Publishing is async but we don't wait for it to complete.
   * Events are queued in SQLite and delivered to subscribers via polling.
   */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const channel = String(event);

    // Create event with standard structure
    const eventData: Event = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: "daemon",
      type: channel,
      payload: data as Record<string, unknown>,
    };

    // Publish asynchronously (fire and forget)
    this.sqliteEventBus.publish(channel, eventData).catch((err) => {
      console.error(`Failed to publish event to ${channel}:`, err);
    });
  }

  /**
   * Remove all listeners for an event (or all events)
   */
  removeAllListeners<K extends keyof EventMap>(event?: K): void {
    if (event) {
      const channel = String(event);
      const unsubscribers = this.unsubscribers.get(channel);
      if (unsubscribers) {
        for (const unsub of unsubscribers) {
          unsub();
        }
        this.unsubscribers.delete(channel);
      }
    } else {
      // Remove all listeners
      for (const [_channel, unsubscribers] of this.unsubscribers.entries()) {
        for (const unsub of unsubscribers) {
          unsub();
        }
      }
      this.unsubscribers.clear();
    }
  }

  /**
   * Close the underlying SQLite EventBus
   */
  async close(): Promise<void> {
    this.removeAllListeners();
    await this.sqliteEventBus.close();
  }
}
