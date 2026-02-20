/**
 * WaitConditionPoller - polls database for wait condition satisfaction
 */

import type { Database } from "../db/db.ts";
import type { WaitCondition } from "./workflowTypes.ts";

export class WaitConditionPoller {
  private db: Database;
  private pollInterval: number;

  constructor(db: Database, pollInterval: number = 100) {
    this.db = db;
    this.pollInterval = pollInterval;
  }

  /**
   * Wait for any of the given conditions to be satisfied
   * @param sessionId - Session to monitor
   * @param conditions - Array of conditions to check
   * @throws Error if timeout occurs or conditions array is empty
   */
  async wait(sessionId: string, conditions: WaitCondition[]): Promise<void> {
    if (conditions.length === 0) {
      throw new Error("At least one wait condition is required");
    }

    const startTime = Date.now();
    const minTimeout = this.getMinTimeout(conditions);

    while (true) {
      // Check timeout
      if (minTimeout !== Infinity && Date.now() - startTime > minTimeout) {
        throw new Error(`Wait condition timeout after ${minTimeout}ms for session ${sessionId}`);
      }

      // Check each condition
      for (const condition of conditions) {
        const satisfied = await this.checkCondition(sessionId, condition);
        if (satisfied) {
          return; // Condition met, resolve
        }
      }

      // Poll interval delay
      await new Promise((resolve) => setTimeout(resolve, this.pollInterval));
    }
  }

  /**
   * Get minimum timeout from all conditions
   */
  private getMinTimeout(conditions: WaitCondition[]): number {
    const timeouts = conditions.map((c) => c.timeout ?? Infinity).filter((t) => t !== undefined);

    return timeouts.length > 0 ? Math.min(...timeouts) : Infinity;
  }

  /**
   * Check if a specific condition is satisfied
   */
  private async checkCondition(sessionId: string, condition: WaitCondition): Promise<boolean> {
    switch (condition.type) {
      case "idle_prompt":
        return this.checkNotification(sessionId, "idle_prompt");

      case "permission_prompt":
        return this.checkNotification(sessionId, "permission_prompt");

      case "stop":
        return this.checkStopEvent(sessionId);

      case "event":
        if (!condition.eventType) {
          throw new Error("eventType is required for event wait condition");
        }
        return this.checkCustomEvent(sessionId, condition.eventType);

      case "timeout":
        // Timeout is handled separately in the main loop
        return false;

      default:
        throw new Error(`Unknown wait condition type: ${(condition as any).type}`);
    }
  }

  /**
   * Check if a notification of given type exists
   */
  private checkNotification(sessionId: string, notificationType: string): boolean {
    const events = this.db.getEventsBySessionId(sessionId, {
      type: "Notification",
      limit: 10, // Check recent events
    });

    // Check if any event has matching notification type
    for (const event of events) {
      const payload = event.payload as any;
      if (payload?.type === notificationType) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if Stop event exists
   */
  private checkStopEvent(sessionId: string): boolean {
    const events = this.db.getEventsBySessionId(sessionId, {
      type: "Stop",
      limit: 1,
    });

    return events.length > 0;
  }

  /**
   * Check if custom event exists
   */
  private checkCustomEvent(sessionId: string, eventType: string): boolean {
    const events = this.db.getEventsBySessionId(sessionId, {
      type: eventType,
      limit: 1,
    });

    return events.length > 0;
  }
}
