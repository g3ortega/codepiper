import * as crypto from "node:crypto";
import type { EventBus, SessionHandle } from "@codepiper/core";
import type { Database } from "../db/db";
import { getProviderDefinition } from "../providers/registry";
import type { AuditLogger } from "../sessions/auditLogger";
import type { PolicyEngine } from "../sessions/policyEngine";
import type { PermissionRequest } from "../sessions/policyTypes";
import { isDangerousModeMetadata, type SessionManager } from "../sessions/sessionManager";

interface InputPolicyContext {
  sessionManager: Pick<SessionManager, "getSession">;
  db: Pick<Database, "getSession" | "getEffectivePolicies" | "insertEvent">;
  eventBus: Pick<EventBus, "emit">;
  policyEngine: Pick<PolicyEngine, "evaluate" | "getDefaultAction">;
  auditLogger: Pick<AuditLogger, "logDecision">;
}

export type InputPolicyRequest =
  | {
      kind: "text";
      input: string;
      newline: boolean;
    }
  | {
      kind: "keys";
      keys: string[];
    };

export interface InputPolicyResult {
  allowed: boolean;
  sessionExists: boolean;
  provider?: SessionHandle["provider"];
  status?: number;
  error?: string;
  policyAction?: "allow" | "deny" | "ask";
}

export class InputPolicyBlockedError extends Error {
  readonly code = "policy_blocked";
  readonly status: number;
  readonly policyAction: "allow" | "deny" | "ask";
  readonly provider?: SessionHandle["provider"];

  constructor(result: InputPolicyResult) {
    const message = result.error || "Input blocked by policy";
    super(message);
    this.name = "InputPolicyBlockedError";
    this.status = result.status ?? 403;
    this.policyAction = result.policyAction ?? "deny";
    this.provider = result.provider;
  }
}

export function assertInputPolicyAllowed(result: InputPolicyResult): void {
  if (result.allowed) {
    return;
  }
  throw new InputPolicyBlockedError(result);
}

function resolveSessionForPolicy(
  ctx: InputPolicyContext,
  sessionId: string
): SessionHandle | undefined {
  return ctx.sessionManager.getSession(sessionId) ?? ctx.db.getSession(sessionId);
}

function hashString(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function buildPolicyRequest(
  session: SessionHandle,
  sessionId: string,
  request: InputPolicyRequest
): PermissionRequest {
  if (request.kind === "text") {
    return {
      sessionId,
      tool: "terminal_input",
      args: {
        input: request.input,
        newline: request.newline,
        provider: session.provider,
      },
      cwd: session.cwd,
    };
  }

  return {
    sessionId,
    tool: "terminal_keys",
    args: {
      keys: request.keys,
      provider: session.provider,
    },
    cwd: session.cwd,
  };
}

function buildPayload(
  session: SessionHandle,
  request: InputPolicyRequest,
  decision: {
    policyAction: "allow" | "deny" | "ask";
    effectiveAction: "allow" | "deny";
    policyId?: string;
    ruleId?: string;
    reason: string;
  }
): Record<string, unknown> {
  const basePayload: Record<string, unknown> = {
    provider: session.provider,
    tool: request.kind === "text" ? "terminal_input" : "terminal_keys",
    policyAction: decision.policyAction,
    effectiveAction: decision.effectiveAction,
    policyId: decision.policyId,
    ruleId: decision.ruleId,
    reason: decision.reason,
  };

  if (request.kind === "text") {
    basePayload.newline = request.newline;
    basePayload.inputBytes = Buffer.byteLength(request.input, "utf8");
    basePayload.inputHash = hashString(request.input);
    return basePayload;
  }

  basePayload.keysCount = request.keys.length;
  basePayload.keysHash = hashString(JSON.stringify(request.keys));
  return basePayload;
}

function buildAuditArgs(
  session: SessionHandle,
  request: InputPolicyRequest
): Record<string, unknown> {
  if (request.kind === "text") {
    return {
      provider: session.provider,
      newline: request.newline,
      inputBytes: Buffer.byteLength(request.input, "utf8"),
      inputHash: hashString(request.input),
    };
  }

  return {
    provider: session.provider,
    keysCount: request.keys.length,
    keysHash: hashString(JSON.stringify(request.keys)),
  };
}

export async function enforceInputPolicyPreflight(
  ctx: InputPolicyContext,
  sessionId: string,
  request: InputPolicyRequest
): Promise<InputPolicyResult> {
  const session = resolveSessionForPolicy(ctx, sessionId);
  if (!session) {
    return { allowed: true, sessionExists: false };
  }

  const providerDefinition = getProviderDefinition(session.provider);
  if (providerDefinition.capabilities.policyChannel !== "input-preflight") {
    return { allowed: true, sessionExists: true, provider: session.provider };
  }

  if (isDangerousModeMetadata(session.metadata)) {
    return { allowed: true, sessionExists: true, provider: session.provider };
  }

  const policyRequest = buildPolicyRequest(session, sessionId, request);
  const policies = ctx.db.getEffectivePolicies(sessionId);
  const policyDecision = await ctx.policyEngine.evaluate(policyRequest, policies);

  let effectiveAction: "allow" | "deny";
  let responseStatus = 403;
  let responseMessage = policyDecision.reason || "Input blocked by policy";

  if (policyDecision.action === "allow") {
    effectiveAction = "allow";
  } else if (
    policyDecision.action === "ask" &&
    !policyDecision.policyId &&
    ctx.policyEngine.getDefaultAction() === "ask"
  ) {
    effectiveAction = "allow";
    responseMessage = "No matching policy rule found (default ask fallback for no-hook provider)";
  } else {
    effectiveAction = "deny";
    if (policyDecision.action === "ask") {
      responseStatus = 409;
      responseMessage =
        policyDecision.reason ||
        "Policy returned ask, but this provider does not support interactive policy approvals";
    }
  }

  const payload = buildPayload(session, request, {
    policyAction: policyDecision.action,
    effectiveAction,
    policyId: policyDecision.policyId,
    ruleId: policyDecision.ruleId,
    reason: responseMessage,
  });

  const eventId = ctx.db.insertEvent({
    sessionId,
    source: "pty",
    type: "InputPolicyDecision",
    payload,
  });

  ctx.eventBus.emit("session:event", {
    id: eventId,
    sessionId,
    type: "InputPolicyDecision",
    source: "pty",
    timestamp: new Date(),
    payload,
  });

  ctx.auditLogger.logDecision({
    sessionId,
    eventId,
    toolName: policyRequest.tool,
    args: buildAuditArgs(session, request),
    decision: policyDecision,
  });

  if (effectiveAction === "deny") {
    return {
      allowed: false,
      sessionExists: true,
      provider: session.provider,
      status: responseStatus,
      error: responseMessage,
      policyAction: policyDecision.action,
    };
  }

  return {
    allowed: true,
    sessionExists: true,
    provider: session.provider,
    policyAction: policyDecision.action,
  };
}
