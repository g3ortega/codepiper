/**
 * ResultExtractor - extracts results from transcript events using regex or JSONPath
 */

import { JSONPath } from "jsonpath-plus";
import type { Database } from "../db/db.ts";
import type { ExtractConfig } from "./workflowTypes.ts";

export class ResultExtractor {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Extract result from transcript events
   * @param sessionId - Session to extract from
   * @param config - Extraction configuration
   * @returns Extracted value or null if not found
   */
  async extract(sessionId: string, config: ExtractConfig): Promise<any> {
    // Validate extract type first
    const configType = config.type as string;
    if (configType !== "regex" && configType !== "jsonpath") {
      throw new Error(`Unknown extract type: ${configType}`);
    }

    // Get all transcript events for session
    const events = this.db.getEventsBySessionId(sessionId, {
      source: "transcript",
    });

    // Concatenate all content
    const allContent = events
      .map((e) => {
        const payload = e.payload as any;
        return payload?.content;
      })
      .filter((content) => content !== null && content !== undefined)
      .join("");

    if (!allContent) {
      return null;
    }

    switch (configType) {
      case "regex":
        return this.extractRegex(allContent, config);

      case "jsonpath":
        return this.extractJsonPath(allContent, config);

      default:
        throw new Error(`Unknown extract type: ${configType}`);
    }
  }

  /**
   * Extract using regex pattern
   */
  private extractRegex(content: string, config: ExtractConfig): any {
    if (!config.pattern) {
      throw new Error("pattern is required for regex extraction");
    }

    const match = content.match(new RegExp(config.pattern));
    if (!match) {
      return null;
    }

    // If there are capture groups, return them
    if (match.length > 2) {
      // Multiple capture groups: return array excluding full match
      return match.slice(1);
    }

    if (match.length === 2) {
      // Single capture group: return just the captured value
      return match[1];
    }

    // No capture groups: return full match
    return match[0];
  }

  /**
   * Extract using JSONPath
   */
  private extractJsonPath(content: string, config: ExtractConfig): any {
    if (!config.path) {
      throw new Error("path is required for jsonpath extraction");
    }

    try {
      // Parse content as JSON
      const parsed = JSON.parse(content);

      // Apply JSONPath query
      const results = JSONPath({ path: config.path, json: parsed });

      if (results.length === 0) {
        return null;
      }

      // Return single result if only one match
      if (results.length === 1) {
        return results[0];
      }

      // Return array if multiple matches
      return results;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse JSON for JSONPath extraction: ${errorMsg}`);
    }
  }
}
