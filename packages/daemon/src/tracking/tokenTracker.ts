import type { Event } from "@codepiper/core";
import type { Database, InsertModelSwitchParams, InsertTokenUsageParams } from "../db/db";

/**
 * Token usage data from Claude Code transcript
 */
export interface TokenUsageData {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  costDifferenceUsd?: number;
}

/**
 * TokenTracker - Extracts and tracks token usage from transcript events
 *
 * Features:
 * - Parses Claude Code transcript JSONL for token usage
 * - Tracks cache metrics (cache_creation_input_tokens, cache_read_input_tokens)
 * - Stores actual cost data from Claude Code
 * - Detects model switches
 * - Provides aggregated statistics
 */
export class TokenTracker {
  private currentModels = new Map<string, string>(); // sessionId -> currentModel

  constructor(private db: Database) {}

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Process transcript event and extract token usage
   */
  async processTranscriptEvent(event: Event): Promise<void> {
    if (event.type !== "transcript:line") {
      return;
    }

    const sessionId = event.sessionId;
    if (!sessionId) {
      console.warn("[TokenTracker] Ignoring transcript event without sessionId");
      return;
    }

    try {
      const transcriptLine = event.payload as any;

      // Extract token usage from assistant messages
      if (transcriptLine.role === "assistant" && transcriptLine.usage) {
        this.processTokenUsage(sessionId, transcriptLine);
      }

      // Detect model switches
      if (transcriptLine.model) {
        this.detectModelSwitch(sessionId, transcriptLine.model);
      }
    } catch (err) {
      console.error(`[TokenTracker] Error processing transcript event: ${this.formatError(err)}`);
    }
  }

  /**
   * Process token usage from transcript line
   */
  private processTokenUsage(sessionId: string, transcriptLine: any): void {
    const usage = transcriptLine.usage;
    const model = transcriptLine.model || "unknown";

    // Calculate total tokens
    const totalTokens =
      (usage.input_tokens || 0) +
      (usage.output_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);

    // Extract cost data if available
    let estimatedCostUsd: number | undefined;
    let actualCostUsd: number | undefined;
    let costDifferenceUsd: number | undefined;

    if (transcriptLine.cost) {
      estimatedCostUsd = transcriptLine.cost.estimated;
      actualCostUsd = transcriptLine.cost.actual;
      if (estimatedCostUsd !== undefined && actualCostUsd !== undefined) {
        costDifferenceUsd = actualCostUsd - estimatedCostUsd;
      }
    }

    const params: InsertTokenUsageParams = {
      sessionId,
      model,
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
      cacheReadInputTokens: usage.cache_read_input_tokens || 0,
      totalTokens,
      estimatedCostUsd,
      actualCostUsd,
      costDifferenceUsd,
    };

    this.db.insertTokenUsage(params);
  }

  /**
   * Detect and record model switches
   */
  private detectModelSwitch(sessionId: string, newModel: string): void {
    const currentModel = this.currentModels.get(sessionId);

    if (currentModel && currentModel !== newModel) {
      // Model switch detected
      const params: InsertModelSwitchParams = {
        sessionId,
        fromModel: currentModel,
        toModel: newModel,
        reason: "Model changed during session",
      };

      this.db.insertModelSwitch(params);
    }

    // Update current model
    this.currentModels.set(sessionId, newModel);
  }

  /**
   * Get token usage statistics for a session
   */
  getSessionStats(sessionId: string): {
    totalTokens: number;
    totalCost: number;
    byModel: Record<string, { tokens: number; cost: number }>;
  } {
    return this.db.getTotalTokensBySessionId(sessionId);
  }

  /**
   * Get recent token usage for a session
   */
  getRecentUsage(sessionId: string, limit: number = 10) {
    return this.db.getTokenUsageBySessionId(sessionId, { limit });
  }

  /**
   * Get model switch history for a session
   */
  getModelSwitches(sessionId: string) {
    return this.db.getModelSwitchesBySessionId(sessionId);
  }

  /**
   * Clear session state (call when session ends)
   */
  clearSessionState(sessionId: string): void {
    this.currentModels.delete(sessionId);
  }
}
