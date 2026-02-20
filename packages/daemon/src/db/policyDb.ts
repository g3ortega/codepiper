/**
 * Policy database operations
 */

import type { Database } from "./db";

/**
 * Policy action types
 */
export type PolicyAction = "allow" | "deny" | "ask";

/**
 * Policy rule definition
 */
export interface PolicyRule {
  id: string;
  action: PolicyAction;
  tool?: string | string[];
  args?: Record<string, string | string[]>;
  cwd?: string | string[];
  session?: string | string[];
  reason?: string;
}

/**
 * Policy record
 */
export interface Policy {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  sessionId: string | null;
  rules: PolicyRule[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Policy decision record
 */
export interface PolicyDecision {
  id: number;
  sessionId: string;
  eventId?: number;
  policyId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  decision: PolicyAction;
  reason?: string;
  timestamp: Date;
}

/**
 * Policy creation parameters
 */
export interface CreatePolicyParams {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  sessionId: string | null;
  rules: PolicyRule[];
}

/**
 * Policy update parameters
 */
export interface UpdatePolicyParams {
  name?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  rules?: PolicyRule[];
}

/**
 * Policy query options
 */
export interface GetPoliciesOptions {
  enabled?: boolean;
  sessionId?: string | null;
}

/**
 * Policy decision insertion parameters
 */
export interface InsertPolicyDecisionParams {
  sessionId: string;
  eventId?: number;
  policyId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  decision: PolicyAction;
  reason?: string;
  timestamp?: Date;
}

/**
 * Policy decision query options
 */
export interface GetPolicyDecisionsOptions {
  since?: Date;
  limit?: number;
  decision?: PolicyAction;
  toolName?: string;
}

/**
 * Policy database interface
 */
export interface PolicyDb {
  // Policy operations
  createPolicy(params: CreatePolicyParams): void;
  getPolicy(id: string): Policy | undefined;
  updatePolicy(id: string, params: UpdatePolicyParams): void;
  deletePolicy(id: string): void;
  getPolicies(options?: GetPoliciesOptions): Policy[];

  // Policy decision operations
  insertPolicyDecision(params: InsertPolicyDecisionParams): number;
  getPolicyDecisions(sessionId: string, options?: GetPolicyDecisionsOptions): PolicyDecision[];
}

/**
 * Create policy database operations
 */
export function createPolicyDb(db: Database): PolicyDb {
  // Get access to underlying Bun database for raw queries
  const bunDb = (db as any).db;

  return {
    /**
     * Create a new policy
     */
    createPolicy(params: CreatePolicyParams): void {
      const now = Date.now();
      const stmt = bunDb.prepare(`
        INSERT INTO policies (
          id, name, description, enabled, priority, session_id,
          rules_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        params.id,
        params.name,
        params.description ?? null,
        params.enabled ? 1 : 0,
        params.priority,
        params.sessionId,
        JSON.stringify(params.rules),
        now,
        now
      );
    },

    /**
     * Get policy by ID
     */
    getPolicy(id: string): Policy | undefined {
      const stmt = bunDb.prepare("SELECT * FROM policies WHERE id = ?");
      const row = stmt.get(id) as any;

      if (!row) return undefined;

      return mapRowToPolicy(row);
    },

    /**
     * Update policy fields
     */
    updatePolicy(id: string, params: UpdatePolicyParams): void {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (params.name !== undefined) {
        updates.push("name = ?");
        values.push(params.name);
      }
      if (params.description !== undefined) {
        updates.push("description = ?");
        values.push(params.description);
      }
      if (params.enabled !== undefined) {
        updates.push("enabled = ?");
        values.push(params.enabled ? 1 : 0);
      }
      if (params.priority !== undefined) {
        updates.push("priority = ?");
        values.push(params.priority);
      }
      if (params.rules !== undefined) {
        updates.push("rules_json = ?");
        values.push(JSON.stringify(params.rules));
      }

      // Always update updated_at
      updates.push("updated_at = ?");
      values.push(Date.now());

      values.push(id);

      const sql = `UPDATE policies SET ${updates.join(", ")} WHERE id = ?`;
      const stmt = bunDb.prepare(sql);
      stmt.run(...values);
    },

    /**
     * Delete policy
     */
    deletePolicy(id: string): void {
      const stmt = bunDb.prepare("DELETE FROM policies WHERE id = ?");
      stmt.run(id);
    },

    /**
     * Get policies with optional filters
     */
    getPolicies(options: GetPoliciesOptions = {}): Policy[] {
      let sql = "SELECT * FROM policies WHERE 1=1";
      const values: unknown[] = [];

      if (options.enabled !== undefined) {
        sql += " AND enabled = ?";
        values.push(options.enabled ? 1 : 0);
      }

      if (options.sessionId !== undefined) {
        if (options.sessionId === null) {
          sql += " AND session_id IS NULL";
        } else {
          sql += " AND session_id = ?";
          values.push(options.sessionId);
        }
      }

      // Order by priority descending (higher priority first)
      sql += " ORDER BY priority DESC";

      const stmt = bunDb.prepare(sql);
      const rows = stmt.all(...values) as any[];

      return rows.map((row) => mapRowToPolicy(row));
    },

    /**
     * Insert a policy decision
     */
    insertPolicyDecision(params: InsertPolicyDecisionParams): number {
      const timestamp = params.timestamp ?? new Date();
      const stmt = bunDb.prepare(`
        INSERT INTO policy_decisions (
          session_id, event_id, policy_id, tool_name, args_json,
          decision, reason, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        params.sessionId,
        params.eventId ?? null,
        params.policyId ?? null,
        params.toolName,
        params.args ? JSON.stringify(params.args) : null,
        params.decision,
        params.reason ?? null,
        timestamp.getTime()
      );

      // Get last inserted row id
      const result = bunDb.query("SELECT last_insert_rowid() as id").get() as { id: number };
      return result.id;
    },

    /**
     * Get policy decisions for a session with optional filters
     */
    getPolicyDecisions(
      sessionId: string,
      options: GetPolicyDecisionsOptions = {}
    ): PolicyDecision[] {
      let sql = "SELECT * FROM policy_decisions WHERE session_id = ?";
      const values: unknown[] = [sessionId];

      if (options.since !== undefined) {
        sql += " AND timestamp > ?";
        values.push(options.since.getTime());
      }

      if (options.decision) {
        sql += " AND decision = ?";
        values.push(options.decision);
      }

      if (options.toolName) {
        sql += " AND tool_name = ?";
        values.push(options.toolName);
      }

      sql += " ORDER BY id ASC";

      if (options.limit) {
        sql += " LIMIT ?";
        values.push(options.limit);
      }

      const stmt = bunDb.prepare(sql);
      const rows = stmt.all(...values) as any[];

      return rows.map((row) => mapRowToPolicyDecision(row));
    },
  };
}

/**
 * Map database row to Policy
 */
function mapRowToPolicy(row: any): Policy {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled === 1,
    priority: row.priority,
    sessionId: row.session_id,
    rules: JSON.parse(row.rules_json),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to PolicyDecision
 */
function mapRowToPolicyDecision(row: any): PolicyDecision {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventId: row.event_id ?? undefined,
    policyId: row.policy_id ?? undefined,
    toolName: row.tool_name,
    args: row.args_json ? JSON.parse(row.args_json) : undefined,
    decision: row.decision as PolicyAction,
    reason: row.reason ?? undefined,
    timestamp: new Date(row.timestamp),
  };
}
