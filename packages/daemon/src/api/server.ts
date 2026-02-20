/**
 * Daemon API server using Bun with Unix socket support
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EventBus } from "@codepiper/core";
import type { Server, ServerWebSocket } from "bun";
import { ApiRateLimiter } from "../auth/apiRateLimiter";
import {
  addSecurityHeaders,
  extractAndHashOnboardingToken,
  extractAndHashToken,
  extractToken,
  getClientIp,
  isPublicRoute,
  MAX_IMAGE_BODY_SIZE,
} from "../auth/authMiddleware";
import type { AuthService } from "../auth/authService";
import { hashToken } from "../auth/authService";
import type { RateLimiter } from "../auth/rateLimiter";
import type { Database } from "../db/db";
import { PushNotifier, type PushNotifierOptions } from "../notifications/pushNotifier";
import { AuditLogger } from "../sessions/auditLogger";
import { PolicyEngine } from "../sessions/policyEngine";
import type { SessionManager } from "../sessions/sessionManager";
import * as analyticsRoutes from "./analyticsRoutes";
import { enforceRequestBodyLimit } from "./bodyLimit";
import * as envSetRoutes from "./envSetRoutes";
import * as gitRoutes from "./gitRoutes";
import { assertInputPolicyAllowed, enforceInputPolicyPreflight } from "./inputPolicy";
import * as notificationRoutes from "./notificationRoutes";
import * as policyRoutes from "./policyRoutes";
import * as policySetRoutes from "./policySetRoutes";
import * as routes from "./routes";
import * as settingsRoutes from "./settingsRoutes";
import * as terminalRoutes from "./terminalRoutes";
import * as validationRoutes from "./validationRoutes";
import * as workflowRoutes from "./workflowRoutes";
import * as workspaceRoutes from "./workspaceRoutes";
import { parseWsMessage, WebSocketManager } from "./ws";

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_API_RATE_LIMIT_MAX = 300;
const DEFAULT_API_RATE_LIMIT_WINDOW_MS = 10_000;
const STATE_CHANGING_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WS_UPGRADE_DATA: unknown = null;

function isMfaOnboardingRoute(apiPath: string): boolean {
  return apiPath === "/auth/mfa/setup" || apiPath === "/auth/mfa/verify";
}

/**
 * Extract hostname from a string that may be a bare hostname or a full URL.
 * Falls back to treating the input as a bare hostname if URL parsing fails.
 */
function parseHostname(entry: string): string {
  try {
    const url = new URL(entry.includes("://") ? entry : `https://${entry}`);
    return url.hostname;
  } catch {
    return entry;
  }
}

/**
 * Allowed origin hostnames parsed from CODEPIPER_ALLOWED_ORIGINS env var.
 * Accepts comma-separated hostnames or origins (e.g. "myapp.example.com,other.dev"
 * or "https://myapp.example.com").
 */
const allowedOrigins: Set<string> = new Set(
  (process.env.CODEPIPER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseHostname)
);

/**
 * Check whether a hostname is allowed (localhost or in CODEPIPER_ALLOWED_ORIGINS).
 */
function isAllowedOriginHostname(hostname: string): boolean {
  return LOCALHOST_HOSTNAMES.has(hostname) || allowedOrigins.has(hostname);
}

/**
 * Validate that the Origin header (if present) is from an allowed host.
 * Returns a 403 Response if the origin is rejected, null if valid.
 * Prevents Cross-Site WebSocket Hijacking (CSWSH).
 */
function rejectNonLocalOrigin(req: Request): Response | null {
  const origin = req.headers.get("Origin");
  if (!origin) return null;

  try {
    const originUrl = new URL(origin);
    if (isAllowedOriginHostname(originUrl.hostname)) {
      return null;
    }
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  } catch {
    return Response.json({ error: "Invalid Origin header" }, { status: 403 });
  }
}

/**
 * Validate browser-originated state-changing API requests to mitigate CSRF.
 *
 * Rules:
 * - Safe methods (GET/HEAD/OPTIONS) are exempt.
 * - Requests without Origin/Referer are treated as non-browser clients and allowed.
 * - If Origin/Referer is present, it must match the request origin OR be explicitly allowed via
 *   CODEPIPER_ALLOWED_ORIGINS.
 */
function rejectCrossSiteApiRequest(req: Request): Response | null {
  if (!STATE_CHANGING_HTTP_METHODS.has(req.method.toUpperCase())) {
    return null;
  }

  const originHeader = req.headers.get("Origin");
  const refererHeader = req.headers.get("Referer");
  const source = originHeader ?? refererHeader;
  if (!source) {
    return null;
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source);
  } catch {
    return Response.json({ error: "Invalid Origin/Referer header" }, { status: 403 });
  }

  const targetUrl = new URL(req.url);
  if (sourceUrl.origin === targetUrl.origin) {
    return null;
  }

  // Explicit allowlist for deployments serving UI from a distinct trusted origin.
  if (allowedOrigins.has(sourceUrl.hostname)) {
    return null;
  }

  return Response.json({ error: "Cross-site request blocked" }, { status: 403 });
}

function parsePositiveIntEnv(varName: string, fallback: number): number {
  const raw = process.env[varName];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function cleanupSocketFile(socketPath: string): void {
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch (err) {
    console.warn(`[server] Failed to clean up socket file ${socketPath}:`, err);
  }
}

/**
 * Verify that a resolved path is contained within a base directory.
 * Prevents path traversal via sibling-prefix tricks (e.g. /web-malicious vs /web).
 */
export function isPathWithinBaseDir(baseDir: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === "" || !(relative.startsWith("..") || path.isAbsolute(relative));
}

function resolveRealPath(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Resolve symlinks and verify that the canonical target still lives under baseDir.
 * Prevents serving files via symlink escape from an otherwise contained lexical path.
 */
export function isRealPathWithinBaseDir(baseDir: string, targetPath: string): boolean {
  const realBase = resolveRealPath(baseDir);
  const realTarget = resolveRealPath(targetPath);
  if (!(realBase && realTarget)) {
    return false;
  }
  return isPathWithinBaseDir(realBase, realTarget);
}

export interface DaemonServer {
  stop(): Promise<void>;
  wsManager: WebSocketManager;
  wsPort: number;
  httpPort: number;
  eventBus: EventBus<Record<string, any>>;
  db: Database;
}

interface Route {
  method: string;
  pattern: RegExp;
  handler: (req: Request, ctx: routes.RouteContext, ...params: string[]) => Promise<Response>;
}

/**
 * Create and start the daemon API server
 */
export async function createServer(
  socketPath: string,
  sessionManager: SessionManager,
  db: Database,
  eventBus: EventBus<Record<string, any>>,
  options?: {
    webDir?: string;
    httpPort?: number;
    authService?: AuthService;
    rateLimiter?: RateLimiter;
    onRestartRequested?: () => Promise<void> | void;
    pushNotifier?: PushNotifier;
    pushNotifierOptions?: PushNotifierOptions;
  }
): Promise<DaemonServer> {
  const isTestMode = process.env.NODE_ENV === "test" || process.env.BUN_TEST === "1";
  const daemonSettings = db.getDaemonSettings();

  // Check if socket already exists
  if (fs.existsSync(socketPath)) {
    throw new Error(`Socket already exists: ${socketPath}`);
  }

  // Create policy engine with default action from daemon settings
  const policyEngine = new PolicyEngine({
    defaultAction: daemonSettings.defaultPolicyAction,
  });
  const auditLogger = new AuditLogger(db);

  // Create WebSocket manager
  const wsManager = new WebSocketManager(eventBus, {
    enablePtyPaste:
      process.env.CODEPIPER_WS_PTY_PASTE === "0"
        ? false
        : daemonSettings.terminalFeatures.wsPtyPasteEnabled,
    onPtyInput: async (sessionId: string, data: string) => {
      const policyCheck = await enforceInputPolicyPreflight(
        { sessionManager, db, eventBus, policyEngine, auditLogger },
        sessionId,
        {
          kind: "text",
          input: data,
          newline: false,
        }
      );
      assertInputPolicyAllowed(policyCheck);
      await sessionManager.sendText(sessionId, data);
    },
    onPtyPaste: async (sessionId: string, data: string) => {
      const policyCheck = await enforceInputPolicyPreflight(
        { sessionManager, db, eventBus, policyEngine, auditLogger },
        sessionId,
        {
          kind: "text",
          input: data,
          newline: false,
        }
      );
      assertInputPolicyAllowed(policyCheck);
      await sessionManager.sendText(sessionId, data);
    },
    onPtyKey: async (sessionId: string, key: string) => {
      const policyCheck = await enforceInputPolicyPreflight(
        { sessionManager, db, eventBus, policyEngine, auditLogger },
        sessionId,
        {
          kind: "keys",
          keys: [key],
        }
      );
      assertInputPolicyAllowed(policyCheck);
      await sessionManager.sendKeys(sessionId, [key]);
    },
  });
  const pushNotifier =
    options?.pushNotifier ?? new PushNotifier(db, eventBus, options?.pushNotifierOptions);
  pushNotifier.start();
  const apiRateLimiter = new ApiRateLimiter({
    maxRequests: parsePositiveIntEnv("CODEPIPER_API_RATE_LIMIT_MAX", DEFAULT_API_RATE_LIMIT_MAX),
    windowMs: parsePositiveIntEnv(
      "CODEPIPER_API_RATE_LIMIT_WINDOW_MS",
      DEFAULT_API_RATE_LIMIT_WINDOW_MS
    ),
  });

  const authService = options?.authService;
  const rateLimiter = options?.rateLimiter;

  // Hook secret for authenticating hook-forward requests
  let hookSecret = process.env.CODEPIPER_SECRET;
  if (!hookSecret) {
    hookSecret = crypto.randomBytes(32).toString("hex");
    process.env.CODEPIPER_SECRET = hookSecret;
    if (!isTestMode) {
      console.warn(
        "[security] CODEPIPER_SECRET was missing. Generated an ephemeral secret for this daemon process."
      );
    }
  }

  // Create route context
  const ctx: routes.RouteContext = {
    sessionManager,
    db,
    eventBus,
    policyEngine,
    auditLogger,
    authService,
    rateLimiter,
    hookSecret,
    restartDaemon: options?.onRestartRequested,
    pushNotifier,
  };

  // Define routes
  const routeHandlers: Route[] = [
    // Health & version
    {
      method: "GET",
      pattern: /^\/health$/,
      handler: async (req, ctx) => routes.handleHealth(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/version$/,
      handler: async (req, ctx) => routes.handleVersion(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/providers$/,
      handler: async (req, ctx) => routes.handleListProviders(req, ctx),
    },

    // Sessions
    {
      method: "GET",
      pattern: /^\/sessions$/,
      handler: async (req, ctx) => routes.handleListSessions(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/sessions$/,
      handler: async (req, ctx) => routes.handleCreateSession(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, sessionId) => routes.handleGetSession(req, ctx, sessionId),
    },
    {
      method: "PUT",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/name$/,
      handler: async (req, ctx, sessionId) => routes.handleUpdateSessionName(req, ctx, sessionId),
    },

    // Session control
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/stop$/,
      handler: async (req, ctx, sessionId) => routes.handleStopSession(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/kill$/,
      handler: async (req, ctx, sessionId) => routes.handleKillSession(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/resume$/,
      handler: async (req, ctx, sessionId) => routes.handleResumeSession(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/recover$/,
      handler: async (req, ctx, sessionId) => routes.handleRecoverSession(req, ctx, sessionId),
    },

    // Session input
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/send$/,
      handler: async (req, ctx, sessionId) => routes.handleSendText(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/keys$/,
      handler: async (req, ctx, sessionId) => routes.handleSendKeys(req, ctx, sessionId),
    },

    // Model switching (claude-code only)
    {
      method: "PUT",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/model$/,
      handler: async (req, ctx, sessionId) => routes.handleSwitchModel(req, ctx, sessionId),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/model$/,
      handler: async (req, ctx, sessionId) => routes.handleGetModel(req, ctx, sessionId),
    },

    // Session-specific policies
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/policy$/,
      handler: async (req, ctx, sessionId) => routes.handleGetSessionPolicy(req, ctx, sessionId),
    },
    {
      method: "PUT",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/policy$/,
      handler: async (req, ctx, sessionId) => routes.handleSetSessionPolicy(req, ctx, sessionId),
    },

    // Session output (current terminal capture)
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/output$/,
      handler: async (req, ctx, sessionId) => routes.handleGetSessionOutput(req, ctx, sessionId),
    },

    // Session resize
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/resize$/,
      handler: async (req, ctx, sessionId) => routes.handleResizeSession(req, ctx, sessionId),
    },

    // Session image upload
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/upload-image$/,
      handler: async (req, ctx, sessionId) => routes.handleUploadImage(req, ctx, sessionId),
    },

    // Session events (all sources, or filtered by ?source=hook|transcript)
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/events$/,
      handler: async (req, ctx, sessionId) => routes.handleGetTranscriptEvents(req, ctx, sessionId),
    },

    // Session transcript events (legacy endpoint - filters to transcript source)
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/transcript\/events$/,
      handler: async (req, ctx, sessionId) => {
        // Add source=transcript to the request URL
        const url = new URL(req.url);
        url.searchParams.set("source", "transcript");
        const modifiedReq = new Request(url.toString(), req);
        return routes.handleGetTranscriptEvents(modifiedReq, ctx, sessionId);
      },
    },

    // Session notification preferences
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/notifications\/prefs$/,
      handler: async (req, ctx, sessionId) =>
        notificationRoutes.handleGetSessionNotificationPrefs(req, ctx, sessionId),
    },
    {
      method: "PUT",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/notifications\/prefs$/,
      handler: async (req, ctx, sessionId) =>
        notificationRoutes.handleUpdateSessionNotificationPrefs(req, ctx, sessionId),
    },

    // Notification inbox
    {
      method: "GET",
      pattern: /^\/notifications$/,
      handler: async (req, ctx) => notificationRoutes.handleListNotifications(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/notifications\/counts$/,
      handler: async (req, ctx) => notificationRoutes.handleGetNotificationCounts(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/notifications\/push\/status$/,
      handler: async (req, ctx) => notificationRoutes.handleGetPushStatus(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/notifications\/push\/test$/,
      handler: async (req, ctx) => notificationRoutes.handleSendTestPushNotification(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/notifications\/push\/subscriptions$/,
      handler: async (req, ctx) => notificationRoutes.handleListPushSubscriptions(req, ctx),
    },
    {
      method: "PUT",
      pattern: /^\/notifications\/push\/subscriptions$/,
      handler: async (req, ctx) => notificationRoutes.handleUpsertPushSubscription(req, ctx),
    },
    {
      method: "DELETE",
      pattern: /^\/notifications\/push\/subscriptions$/,
      handler: async (req, ctx) => notificationRoutes.handleDeletePushSubscription(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/notifications\/read$/,
      handler: async (req, ctx) => notificationRoutes.handleMarkNotificationsRead(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/notifications\/([0-9]+)\/read$/,
      handler: async (req, ctx, notificationId) =>
        notificationRoutes.handleMarkNotificationRead(req, ctx, notificationId),
    },

    // Hooks
    {
      method: "POST",
      pattern: /^\/hooks\/claude$/,
      handler: async (req, ctx) => routes.handleClaudeHook(req, ctx),
    },

    // Auth (these are also handled specially, but included for route existence checks)
    {
      method: "GET",
      pattern: /^\/auth\/status$/,
      handler: async (req, ctx) => {
        const { handleAuthStatus } = await import("./authRoutes");
        return handleAuthStatus(req, ctx);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/setup$/,
      handler: async (req, ctx) => {
        const { handleAuthSetup } = await import("./authRoutes");
        return handleAuthSetup(req, ctx);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/login$/,
      handler: async (req, ctx) => {
        const { handleAuthLogin } = await import("./authRoutes");
        return handleAuthLogin(req, ctx);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/logout$/,
      handler: async (req, ctx) => {
        const { handleAuthLogout } = await import("./authRoutes");
        return handleAuthLogout(req, ctx);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/password$/,
      handler: async (req, ctx) => {
        const { handleAuthChangePassword } = await import("./authRoutes");
        return handleAuthChangePassword(req, ctx);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/mfa\/setup$/,
      handler: async (req, ctx) => {
        const { handleMfaSetup } = await import("./authRoutes");
        return handleMfaSetup(req, ctx);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/mfa\/verify$/,
      handler: async (req, ctx) => {
        const { handleMfaVerify } = await import("./authRoutes");
        return handleMfaVerify(req, ctx);
      },
    },
    {
      method: "GET",
      pattern: /^\/auth\/sessions$/,
      handler: async (req, ctx) => {
        const { handleAuthSessions } = await import("./authRoutes");
        return handleAuthSessions(req, ctx);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/sessions\/revoke-all$/,
      handler: async (req, ctx) => {
        const { handleAuthRevokeAll } = await import("./authRoutes");
        return handleAuthRevokeAll(req, ctx);
      },
    },
    // CLI-only auth routes (Unix socket access only, but registered here for routing)
    {
      method: "POST",
      pattern: /^\/auth\/cli\/reset-password$/,
      handler: async (req, ctx) => {
        const { handleCliResetPassword } = await import("./authRoutes");
        return handleCliResetPassword(req, ctx);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/cli\/reset-mfa$/,
      handler: async (req, ctx) => {
        const { handleCliResetMfa } = await import("./authRoutes");
        return handleCliResetMfa(req, ctx);
      },
    },

    // Policies
    {
      method: "GET",
      pattern: /^\/policies$/,
      handler: async (req, ctx) => policyRoutes.handleListPolicies(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/policies$/,
      handler: async (req, ctx) => policyRoutes.handleCreatePolicy(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/policies\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, policyId) => policyRoutes.handleGetPolicy(req, ctx, policyId),
    },
    {
      method: "PUT",
      pattern: /^\/policies\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, policyId) => policyRoutes.handleUpdatePolicy(req, ctx, policyId),
    },
    {
      method: "DELETE",
      pattern: /^\/policies\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, policyId) => policyRoutes.handleDeletePolicy(req, ctx, policyId),
    },

    // Policy Sets
    {
      method: "GET",
      pattern: /^\/policy-sets$/,
      handler: async (req, ctx) => policySetRoutes.handleListPolicySets(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/policy-sets$/,
      handler: async (req, ctx) => policySetRoutes.handleCreatePolicySet(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/policy-sets\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, setId) => policySetRoutes.handleGetPolicySet(req, ctx, setId),
    },
    {
      method: "PUT",
      pattern: /^\/policy-sets\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, setId) => policySetRoutes.handleUpdatePolicySet(req, ctx, setId),
    },
    {
      method: "DELETE",
      pattern: /^\/policy-sets\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, setId) => policySetRoutes.handleDeletePolicySet(req, ctx, setId),
    },
    {
      method: "POST",
      pattern: /^\/policy-sets\/([a-zA-Z0-9-]+)\/policies$/,
      handler: async (req, ctx, setId) => policySetRoutes.handleAddPolicyToSet(req, ctx, setId),
    },
    {
      method: "DELETE",
      pattern: /^\/policy-sets\/([a-zA-Z0-9-]+)\/policies\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, setId, policyId) =>
        policySetRoutes.handleRemovePolicyFromSet(req, ctx, setId, policyId),
    },
    // Session policy sets
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/policy-sets$/,
      handler: async (req, ctx, sessionId) =>
        policySetRoutes.handleGetSessionPolicySets(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/policy-sets$/,
      handler: async (req, ctx, sessionId) =>
        policySetRoutes.handleApplyPolicySetToSession(req, ctx, sessionId),
    },
    {
      method: "DELETE",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/policy-sets\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, sessionId, setId) =>
        policySetRoutes.handleRemovePolicySetFromSession(req, ctx, sessionId, setId),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/effective-policies$/,
      handler: async (req, ctx, sessionId) =>
        policySetRoutes.handleGetEffectivePolicies(req, ctx, sessionId),
    },
    // Policy decisions (audit log)
    {
      method: "GET",
      pattern: /^\/policy-decisions$/,
      handler: async (req, ctx) => policySetRoutes.handleListPolicyDecisions(req, ctx),
    },

    // Workspaces
    {
      method: "GET",
      pattern: /^\/workspaces$/,
      handler: async (req, ctx) => workspaceRoutes.handleListWorkspaces(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/workspaces$/,
      handler: async (req, ctx) => workspaceRoutes.handleCreateWorkspace(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/workspaces\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, id) => workspaceRoutes.handleGetWorkspace(req, ctx, id),
    },
    {
      method: "PUT",
      pattern: /^\/workspaces\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, id) => workspaceRoutes.handleUpdateWorkspace(req, ctx, id),
    },
    {
      method: "DELETE",
      pattern: /^\/workspaces\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, id) => workspaceRoutes.handleDeleteWorkspace(req, ctx, id),
    },

    // Env Sets
    {
      method: "GET",
      pattern: /^\/env-sets$/,
      handler: async (req, ctx) => envSetRoutes.handleListEnvSets(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/env-sets$/,
      handler: async (req, ctx) => envSetRoutes.handleCreateEnvSet(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/env-sets\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, id) => envSetRoutes.handleGetEnvSet(req, ctx, id),
    },
    {
      method: "PUT",
      pattern: /^\/env-sets\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, id) => envSetRoutes.handleUpdateEnvSet(req, ctx, id),
    },
    {
      method: "DELETE",
      pattern: /^\/env-sets\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, id) => envSetRoutes.handleDeleteEnvSet(req, ctx, id),
    },

    // Daemon Settings
    {
      method: "GET",
      pattern: /^\/settings\/daemon$/,
      handler: async (req, ctx) => settingsRoutes.handleGetDaemonSettings(req, ctx),
    },
    {
      method: "PUT",
      pattern: /^\/settings\/daemon$/,
      handler: async (req, ctx) => settingsRoutes.handleUpdateDaemonSettings(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/settings\/daemon\/restart$/,
      handler: async (req, ctx) => settingsRoutes.handleRestartDaemon(req, ctx),
    },

    // Session Validation
    {
      method: "POST",
      pattern: /^\/sessions\/validate$/,
      handler: async (req, ctx) => validationRoutes.handleValidateSession(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/validate-git$/,
      handler: async (req, ctx) => validationRoutes.handleValidateGit(req, ctx),
    },

    // Analytics
    {
      method: "GET",
      pattern: /^\/analytics\/overview$/,
      handler: async (req, ctx) => analyticsRoutes.handleAnalyticsOverview(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/analytics\/activity-timeline$/,
      handler: async (req, ctx) => analyticsRoutes.handleActivityTimeline(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/analytics\/tokens-by-model$/,
      handler: async (req, ctx) => analyticsRoutes.handleTokensByModel(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/analytics\/token-usage$/,
      handler: async (req, ctx) => analyticsRoutes.handleTokenUsage(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/analytics\/sessions-by-provider$/,
      handler: async (req, ctx) => analyticsRoutes.handleSessionsByProvider(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/analytics\/tool-usage$/,
      handler: async (req, ctx) => analyticsRoutes.handleToolUsage(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/analytics\/policy-decisions$/,
      handler: async (req, ctx) => analyticsRoutes.handlePolicyDecisions(req, ctx),
    },

    // Git operations (per session)
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/status$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitStatus(req, ctx, sessionId),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/branches$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitBranches(req, ctx, sessionId),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/log$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitLog(req, ctx, sessionId),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/diff$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitDiff(req, ctx, sessionId),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/file$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitFile(req, ctx, sessionId),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/file-raw$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitFileRaw(req, ctx, sessionId),
    },
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/diff-stat$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitDiffStat(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/stage$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitStage(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/git\/unstage$/,
      handler: async (req, ctx, sessionId) => gitRoutes.handleGitUnstage(req, ctx, sessionId),
    },

    // Terminal modes (scroll, search)
    {
      method: "GET",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/terminal\/info$/,
      handler: async (req, ctx, sessionId) =>
        terminalRoutes.handleGetTerminalInfo(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/terminal\/mode$/,
      handler: async (req, ctx, sessionId) =>
        terminalRoutes.handleTerminalMode(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/terminal\/scroll$/,
      handler: async (req, ctx, sessionId) =>
        terminalRoutes.handleTerminalScroll(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/terminal\/search$/,
      handler: async (req, ctx, sessionId) =>
        terminalRoutes.handleTerminalSearch(req, ctx, sessionId),
    },
    {
      method: "POST",
      pattern: /^\/sessions\/([a-zA-Z0-9-]+)\/terminal\/transcribe$/,
      handler: async (req, ctx, sessionId) =>
        terminalRoutes.handleTerminalTranscribe(req, ctx, sessionId),
    },

    // Workflows
    {
      method: "GET",
      pattern: /^\/workflows$/,
      handler: async (req, ctx) => workflowRoutes.handleListWorkflows(req, ctx),
    },
    {
      method: "POST",
      pattern: /^\/workflows$/,
      handler: async (req, ctx) => workflowRoutes.handleCreateWorkflow(req, ctx),
    },
    {
      method: "GET",
      pattern: /^\/workflows\/executions\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, execId) => workflowRoutes.handleGetExecutionById(req, ctx, execId),
    },
    {
      method: "POST",
      pattern: /^\/workflows\/executions\/([a-zA-Z0-9-]+)\/cancel$/,
      handler: async (req, ctx, execId) =>
        workflowRoutes.handleCancelExecutionById(req, ctx, execId),
    },
    {
      method: "GET",
      pattern: /^\/workflows\/([a-zA-Z0-9-_]+)$/,
      handler: async (req, ctx, workflowId) =>
        workflowRoutes.handleGetWorkflow(req, ctx, workflowId),
    },
    {
      method: "DELETE",
      pattern: /^\/workflows\/([a-zA-Z0-9-_]+)$/,
      handler: async (req, ctx, workflowId) =>
        workflowRoutes.handleDeleteWorkflow(req, ctx, workflowId),
    },
    {
      method: "POST",
      pattern: /^\/workflows\/([a-zA-Z0-9-_]+)\/execute$/,
      handler: async (req, ctx, workflowId) =>
        workflowRoutes.handleExecuteWorkflow(req, ctx, workflowId),
    },
    {
      method: "GET",
      pattern: /^\/workflows\/([a-zA-Z0-9-_]+)\/executions$/,
      handler: async (req, ctx, workflowId) =>
        workflowRoutes.handleListExecutions(req, ctx, workflowId),
    },
    {
      method: "GET",
      pattern: /^\/workflows\/([a-zA-Z0-9-_]+)\/executions\/([a-zA-Z0-9-]+)$/,
      handler: async (req, ctx, workflowId, execId) =>
        workflowRoutes.handleGetExecution(req, ctx, workflowId, execId),
    },
    {
      method: "POST",
      pattern: /^\/workflows\/([a-zA-Z0-9-_]+)\/executions\/([a-zA-Z0-9-]+)\/cancel$/,
      handler: async (req, ctx, workflowId, execId) =>
        workflowRoutes.handleCancelExecution(req, ctx, workflowId, execId),
    },
  ];

  // Server reference (will be set after Bun.serve)
  let serverRef: Server<unknown>;

  // Create request handler
  const handleRequest = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const method = req.method;
    const pathname = url.pathname;

    // Handle WebSocket upgrade on /ws
    if (pathname === "/ws") {
      if (serverRef?.upgrade(req, { data: WS_UPGRADE_DATA })) {
        return new Response(null); // Upgrade successful, handled by websocket handlers
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    const bodyLimitResult = await enforceRequestBodyLimit(req, pathname);
    if (bodyLimitResult instanceof Response) {
      return bodyLimitResult;
    }
    req = bodyLimitResult;

    // Find matching route
    for (const route of routeHandlers) {
      if (route.method !== method) {
        continue;
      }

      const match = pathname.match(route.pattern);
      if (match) {
        try {
          // Extract path parameters (exclude full match)
          const params = match.slice(1);
          return await route.handler(req, ctx, ...params);
        } catch (error) {
          // Handle JSON parsing errors
          if (error instanceof SyntaxError) {
            return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
          }

          // Log error and return 500 (no internal details in response)
          console.error("Error handling request:", error);
          return Response.json({ error: "Internal server error" }, { status: 500 });
        }
      }
    }

    // Check if route exists but method is wrong
    const routeExists = routeHandlers.some((route) => pathname.match(route.pattern));

    if (routeExists) {
      return Response.json(
        { error: `Method ${method} not allowed for ${pathname}` },
        { status: 405 }
      );
    }

    // No route found
    return Response.json({ error: `Not found: ${pathname}` }, { status: 404 });
  };

  // WebSocket handlers (shared between Unix and TCP servers)
  const wsHandlers = {
    open(ws: ServerWebSocket<unknown>) {
      wsManager.handleConnection(ws);
    },
    message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
      try {
        const data = parseWsMessage(message);
        wsManager.handleMessage(ws, data);
      } catch (error) {
        console.error("WebSocket message error:", error);
        const errorMessage = error instanceof Error ? error.message : "Invalid message";
        const normalized = errorMessage.toLowerCase();
        if (normalized.includes("too large")) {
          ws.close(1009, "Message too large");
          return;
        }
        if (normalized.includes("rate limit")) {
          ws.close(1013, "Rate limit exceeded");
          return;
        }
        ws.send(JSON.stringify({ error: errorMessage }));
      }
    },
    close(ws: ServerWebSocket<unknown>) {
      wsManager.handleDisconnect(ws);
    },
    drain(ws: ServerWebSocket<unknown>) {
      wsManager.handleDrain(ws);
    },
  };

  // Start main server on unix socket
  try {
    serverRef = Bun.serve({
      unix: socketPath,
      fetch: handleRequest,
      websocket: wsHandlers,
      maxRequestBodySize: MAX_IMAGE_BODY_SIZE,
    });
    // Restrict socket to owner only (prevents other local users from connecting)
    fs.chmodSync(socketPath, 0o600);
  } catch (err: any) {
    pushNotifier.stop();
    if (err?.code === "EADDRINUSE") {
      throw new Error(
        `Socket ${socketPath} is already in use. Another daemon may be running.\n` +
          `  Kill it with: pkill -f "bun.*daemon" or rm ${socketPath}`
      );
    }
    throw err;
  }

  const server = serverRef;

  // Also start WebSocket server on TCP for clients that don't support Unix socket WebSockets
  // In test mode, use port 0 to get random available port
  const wsPort = isTestMode ? 0 : Number.parseInt(process.env.CODEPIPER_WS_PORT || "9999", 10);

  let wsServer: ReturnType<typeof Bun.serve>;
  try {
    wsServer = Bun.serve({
      port: wsPort,
      hostname: "127.0.0.1",
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          const originReject = rejectNonLocalOrigin(req);
          if (originReject) return originReject;

          // Auth check on WS upgrade (cookie or Authorization header only — no query params)
          if (authService) {
            const token = extractToken(req);
            if (!(token && authService.validateSession(hashToken(token)))) {
              return Response.json({ error: "Authentication required" }, { status: 401 });
            }
          }
          if (wsServer.upgrade(req, { data: WS_UPGRADE_DATA })) {
            return new Response(null);
          }
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return new Response("WebSocket endpoint only - use Unix socket for HTTP API", {
          status: 400,
        });
      },
      websocket: wsHandlers,
      maxRequestBodySize: MAX_IMAGE_BODY_SIZE,
    });
  } catch (err: any) {
    pushNotifier.stop();
    wsManager.shutdown();
    apiRateLimiter.destroy();
    server.stop(true);
    cleanupSocketFile(socketPath);
    if (err?.code === "EADDRINUSE") {
      throw new Error(
        `WebSocket port ${wsPort} is already in use. Another daemon may be running.\n` +
          `  Kill it with: pkill -f "bun.*daemon" or lsof -ti:${wsPort} | xargs kill\n` +
          `  Or use a different port: CODEPIPER_WS_PORT=9998 codepiper daemon`
      );
    }
    throw err;
  }

  // HTTP server: starts in development mode OR when webDir is provided
  const isDevelopment = process.env.NODE_ENV === "development";
  const webDir = options?.webDir;
  const shouldStartHttp = isDevelopment || webDir;
  const httpPort = options?.httpPort
    ? options.httpPort
    : Number.parseInt(process.env.CODEPIPER_HTTP_PORT || "3000", 10);
  let httpServer: Server<unknown> | null = null;

  // Create HTTP request handler that serves API + static files (with auth)
  const httpFetchHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Handle WebSocket upgrade (with auth — cookie or Authorization header only)
    if (pathname === "/ws") {
      const originReject = rejectNonLocalOrigin(req);
      if (originReject) return addSecurityHeaders(originReject);

      if (authService) {
        const token = extractToken(req);
        if (!(token && authService.validateSession(hashToken(token)))) {
          return Response.json({ error: "Authentication required" }, { status: 401 });
        }
      }
      if (httpServer?.upgrade(req, { data: WS_UPGRADE_DATA })) {
        return new Response(null);
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Determine the API path (strip /api prefix if present)
    const isApiRoute = pathname.startsWith("/api");
    const apiPath = isApiRoute ? pathname.replace(/^\/api/, "") || "/" : pathname;

    if (isApiRoute) {
      const csrfReject = rejectCrossSiteApiRequest(req);
      if (csrfReject) {
        return addSecurityHeaders(csrfReject);
      }
    }

    // Block CLI-only routes from HTTP — always, regardless of auth config
    if (isApiRoute && apiPath.startsWith("/auth/cli/")) {
      return addSecurityHeaders(Response.json({ error: "Not found" }, { status: 404 }));
    }

    // Auth enforcement for API routes
    if (authService && isApiRoute) {
      if (!isPublicRoute(req.method, apiPath)) {
        const sessionTokenHash = extractAndHashToken(req);
        if (!sessionTokenHash) {
          const allowsOnboardingBypass =
            isMfaOnboardingRoute(apiPath) && authService.isMfaSetupPending();
          if (allowsOnboardingBypass) {
            const onboardingTokenHash = extractAndHashOnboardingToken(req);
            if (onboardingTokenHash && authService.validateOnboardingToken(onboardingTokenHash)) {
              // Allow onboarding MFA routes with a valid onboarding cookie token.
              // No auth session to touch in this branch.
            } else {
              return addSecurityHeaders(
                Response.json(
                  {
                    error: "Authentication required",
                    setupRequired: authService.isSetupRequired(),
                    mfaSetupRequired: authService.isMfaSetupPending(),
                  },
                  { status: 401 }
                )
              );
            }
          } else {
            return addSecurityHeaders(
              Response.json(
                {
                  error: "Authentication required",
                  setupRequired: authService.isSetupRequired(),
                  mfaSetupRequired: authService.isMfaSetupPending(),
                },
                { status: 401 }
              )
            );
          }
        } else if (!authService.validateSession(sessionTokenHash)) {
          return addSecurityHeaders(
            Response.json(
              {
                error: "Session expired",
                mfaSetupRequired: authService.isMfaSetupPending(),
              },
              { status: 401 }
            )
          );
        } else {
          authService.touchSession(sessionTokenHash);
        }
      }
    }

    // Route API requests
    if (isApiRoute) {
      // Basic API abuse protection for browser-facing HTTP routes.
      const clientIp = getClientIp(req, httpServer ?? undefined);
      const rateLimit = apiRateLimiter.consume(clientIp);
      if (!rateLimit.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.retryAfterMs ?? 0) / 1000));
        return addSecurityHeaders(
          new Response(
            JSON.stringify({ error: "Too many requests", retryAfter: retryAfterSeconds }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": String(retryAfterSeconds),
              },
            }
          )
        );
      }

      const apiUrl = new URL(apiPath + url.search, url.origin);
      const apiReq = new Request(apiUrl.toString(), req);
      const response = await handleRequest(apiReq);
      return addSecurityHeaders(response);
    }

    // Static file serving (only when webDir is configured)
    if (webDir) {
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = path.resolve(webDir, relativePath);

      // Path traversal protection
      if (!isPathWithinBaseDir(webDir, filePath)) {
        return addSecurityHeaders(new Response("Forbidden", { status: 403 }));
      }

      const file = Bun.file(filePath);
      if (await file.exists()) {
        if (!isRealPathWithinBaseDir(webDir, filePath)) {
          return addSecurityHeaders(new Response("Forbidden", { status: 403 }));
        }
        return addSecurityHeaders(new Response(file));
      }

      // SPA fallback: serve index.html for client-side routing
      const indexPath = path.join(webDir, "index.html");
      const indexFile = Bun.file(indexPath);
      if (await indexFile.exists()) {
        if (!isRealPathWithinBaseDir(webDir, indexPath)) {
          return addSecurityHeaders(new Response("Forbidden", { status: 403 }));
        }
        return addSecurityHeaders(
          new Response(indexFile, { headers: { "Content-Type": "text/html" } })
        );
      }
    }

    // For browser requests (Accept: text/html), return an HTML redirect to root
    // instead of raw JSON — handles SPA route refreshes when webDir is missing
    const acceptHeader = req.headers.get("Accept") || "";
    if (acceptHeader.includes("text/html")) {
      return addSecurityHeaders(
        new Response(
          `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=/"></head><body>Redirecting...</body></html>`,
          { status: 302, headers: { "Content-Type": "text/html", Location: "/" } }
        )
      );
    }

    return addSecurityHeaders(Response.json({ error: `Not found: ${pathname}` }, { status: 404 }));
  };

  if (shouldStartHttp && httpPort > 0) {
    try {
      httpServer = Bun.serve({
        port: httpPort,
        hostname: "127.0.0.1",
        fetch: httpFetchHandler,
        websocket: wsHandlers,
        maxRequestBodySize: MAX_IMAGE_BODY_SIZE,
      });
    } catch (err: any) {
      pushNotifier.stop();
      wsManager.shutdown();
      apiRateLimiter.destroy();
      server.stop(true);
      wsServer.stop(true);
      cleanupSocketFile(socketPath);
      if (err?.code === "EADDRINUSE") {
        throw new Error(
          `HTTP port ${httpPort} is already in use.\n` +
            `  Kill the process: lsof -ti:${httpPort} | xargs kill\n` +
            `  Or use a different port: codepiper daemon --web --port ${httpPort + 1}`
        );
      }
      throw err;
    }
    if (webDir) {
      console.log(`Web dashboard: http://127.0.0.1:${httpServer.port}`);
    } else {
      console.log(`Development HTTP server running on http://127.0.0.1:${httpServer.port}`);
    }
  }

  // Return server interface
  return {
    wsManager,
    wsPort: wsServer.port ?? wsPort, // Use actual assigned port (important when port 0 is used)
    httpPort: httpServer?.port ?? 0,
    eventBus,
    db,
    async stop() {
      pushNotifier.stop();

      // Shutdown WebSocket manager first
      wsManager.shutdown();

      // Stop all servers
      server.stop(true);
      wsServer.stop(true);
      if (httpServer) {
        httpServer.stop(true);
      }
      apiRateLimiter.destroy();

      // Close database
      db.close();

      // Clean up socket file
      cleanupSocketFile(socketPath);
    },
  };
}
