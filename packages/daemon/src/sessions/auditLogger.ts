/**
 * AuditLogger - Logs all policy decisions for audit trail and analysis
 */

import type { Database, GetPolicyDecisionsOptions, PolicyDecisionRecord } from "../db/db";
import type { PolicyDecision } from "./policyTypes";

export interface LogDecisionParams {
  sessionId: string;
  eventId?: number;
  toolName: string;
  args: Record<string, unknown>;
  decision: PolicyDecision;
  timestamp?: Date;
}

export interface DecisionStatistics {
  total: number;
  allow: number;
  deny: number;
  ask: number;
}

export class AuditLogger {
  constructor(private db: Database) {}

  /**
   * Log a policy decision to the audit trail
   */
  logDecision(params: LogDecisionParams): number {
    return this.db.insertPolicyDecision({
      sessionId: params.sessionId,
      eventId: params.eventId,
      policyId: params.decision.policyId,
      toolName: params.toolName,
      args: params.args,
      decision: params.decision.action,
      reason: params.decision.reason,
      timestamp: params.timestamp,
    });
  }

  /**
   * Get policy decisions for a session
   */
  getDecisions(sessionId: string, options?: GetPolicyDecisionsOptions): PolicyDecisionRecord[] {
    return this.db.getPolicyDecisionsBySessionId(sessionId, options);
  }

  /**
   * Export decisions in various formats
   */
  exportDecisions(sessionId: string, format: "json" | "csv"): string {
    const decisions = this.getDecisions(sessionId);

    if (format === "json") {
      return JSON.stringify(
        decisions.map((d) => ({
          timestamp: d.timestamp.toISOString(),
          toolName: d.toolName,
          decision: d.decision,
          reason: d.reason,
          policyId: d.policyId,
          ruleId: undefined, // Not stored in decision record
          args: d.args,
          eventId: d.eventId,
        })),
        null,
        2
      );
    }

    if (format === "csv") {
      const header = "timestamp,toolName,decision,reason,policyId,args\n";
      const rows = decisions
        .map((d) => {
          const timestamp = d.timestamp.toISOString();
          const args = d.args ? JSON.stringify(d.args).replace(/"/g, '""') : "";
          const reason = (d.reason ?? "").replace(/"/g, '""');
          return `${timestamp},${d.toolName},${d.decision},"${reason}",${d.policyId ?? ""},"${args}"`;
        })
        .join("\n");

      return `${header + rows}\n`;
    }

    throw new Error(`Unsupported export format: ${format}`);
  }

  /**
   * Get decision statistics for a session
   */
  getStatistics(sessionId: string): DecisionStatistics {
    const decisions = this.getDecisions(sessionId);

    return {
      total: decisions.length,
      allow: decisions.filter((d) => d.decision === "allow").length,
      deny: decisions.filter((d) => d.decision === "deny").length,
      ask: decisions.filter((d) => d.decision === "ask").length,
    };
  }
}
