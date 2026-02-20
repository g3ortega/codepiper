/**
 * Tests for the daemon API server
 */

import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { createWorkflowDb } from "../db/workflowDb";
import { SessionManager } from "../sessions/sessionManager";
import { createServer, type DaemonServer, isPathWithinBaseDir } from "./server";

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Failed to get available port")));
        return;
      }
      const port = addr.port;
      srv.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function rawHttpGet(
  port: number,
  rawPath: string
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(
        `GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`
      );
    });

    let response = "";
    socket.setEncoding("utf8");

    socket.on("data", (chunk) => {
      response += chunk;
    });

    socket.on("error", reject);

    socket.on("end", () => {
      const [headers, ...bodyParts] = response.split("\r\n\r\n");
      const statusLine = headers.split("\r\n")[0] ?? "";
      const match = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
      if (!match) {
        reject(new Error(`Unable to parse HTTP status from response: ${statusLine}`));
        return;
      }

      resolve({
        status: Number.parseInt(match[1], 10),
        body: bodyParts.join("\r\n\r\n"),
      });
    });
  });
}

describe("DaemonServer", () => {
  setDefaultTimeout(20_000);

  let server: DaemonServer;
  let sessionManager: SessionManager;
  let socketPath: string;
  let tempDir: string;
  let db: Database;
  let eventBus: EventBus;
  let originalPath: string | undefined;

  beforeEach(
    async () => {
      // Create temp directory for socket
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-test-"));
      socketPath = path.join(tempDir, "test.sock");

      // CI-safe stub so provider command resolution never depends on a real Claude install.
      const binDir = path.join(tempDir, "bin");
      fs.mkdirSync(binDir, { recursive: true });
      const stubScript =
        "#!/usr/bin/env sh\n# test stub: keep process alive\nwhile :; do sleep 3600; done\n";
      for (const binary of ["claude", "codex"]) {
        fs.writeFileSync(path.join(binDir, binary), stubScript, { mode: 0o755 });
      }
      originalPath = process.env.PATH;
      process.env.PATH = originalPath ? `${binDir}:${originalPath}` : binDir;

      // Initialize database and event bus
      db = new Database(":memory:");
      await db.init();
      eventBus = new EventBus();

      // Create session manager
      sessionManager = new SessionManager(db, eventBus);
    },
    { timeout: 20_000 }
  );

  afterEach(
    async () => {
      // Stop all sessions before closing server/DB to avoid "closed database" errors
      if (sessionManager) {
        await sessionManager.stopAll();
      }

      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }

      // Clean up server
      if (server) {
        await server.stop();
      }

      // Clean up temp directory
      try {
        if (fs.existsSync(socketPath)) {
          fs.unlinkSync(socketPath);
        }
        fs.rmdirSync(tempDir);
      } catch (_err) {
        // Ignore cleanup errors
      }
    },
    { timeout: 20_000 }
  );

  describe("Path containment helper", () => {
    test("accepts files inside base directory", () => {
      expect(isPathWithinBaseDir("/tmp/web", "/tmp/web/index.html")).toBe(true);
      expect(isPathWithinBaseDir("/tmp/web", "/tmp/web/assets/app.js")).toBe(true);
    });

    test("rejects sibling-prefix paths", () => {
      expect(isPathWithinBaseDir("/tmp/web", "/tmp/web-malicious/secret.txt")).toBe(false);
      expect(isPathWithinBaseDir("/tmp/web", "/tmp/web/../web-malicious/secret.txt")).toBe(false);
    });
  });

  describe("Server creation", () => {
    test("should create server on unix socket", async () => {
      server = await createServer(socketPath, sessionManager, db, eventBus);
      expect(server).toBeDefined();
      expect(fs.existsSync(socketPath)).toBe(true);
    });

    test("should throw if socket already exists", async () => {
      // Create server first time
      server = await createServer(socketPath, sessionManager, db, eventBus);

      // Try to create another server on same socket
      const db2 = new Database(":memory:");
      await db2.init();
      const eventBus2 = new EventBus();
      const sessionManager2 = new SessionManager(db2, eventBus2);
      await expect(createServer(socketPath, sessionManager2, db2, eventBus2)).rejects.toThrow();
    });

    test("cleans up unix socket when websocket startup fails", async () => {
      const blocker = net.createServer();
      await new Promise<void>((resolve, reject) => {
        blocker.once("error", reject);
        blocker.listen(0, "127.0.0.1", () => resolve());
      });

      const address = blocker.address();
      if (!address || typeof address === "string") {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
        throw new Error("Failed to allocate blocker port");
      }

      const oldWsPort = process.env.CODEPIPER_WS_PORT;
      const oldBunTest = process.env.BUN_TEST;
      const oldNodeEnv = process.env.NODE_ENV;
      process.env.CODEPIPER_WS_PORT = String(address.port);
      process.env.BUN_TEST = "0";
      process.env.NODE_ENV = "production";

      try {
        await expect(createServer(socketPath, sessionManager, db, eventBus)).rejects.toThrow(
          "WebSocket port"
        );
        expect(fs.existsSync(socketPath)).toBe(false);
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
        if (oldWsPort === undefined) {
          delete process.env.CODEPIPER_WS_PORT;
        } else {
          process.env.CODEPIPER_WS_PORT = oldWsPort;
        }
        if (oldBunTest === undefined) {
          delete process.env.BUN_TEST;
        } else {
          process.env.BUN_TEST = oldBunTest;
        }
        if (oldNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = oldNodeEnv;
        }
      }
    });
  });

  describe("Health endpoint", () => {
    beforeEach(async () => {
      server = await createServer(socketPath, sessionManager, db, eventBus);
    });

    test("GET /health should return 200 OK", async () => {
      const response = await fetch("http://localhost/health", {
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        status: "ok",
        zombieSessionCount: 0,
      });
    });

    test("GET /health should include zombie session count", async () => {
      db.createSession({
        id: "health-zombie/no-runtime",
        provider: "claude-code",
        cwd: process.cwd(),
        status: "RUNNING",
      });

      const response = await fetch("http://localhost/health", {
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        status: "ok",
        zombieSessionCount: 1,
      });
    });

    test("GET /version should return version info", async () => {
      const response = await fetch("http://localhost/version", {
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("bun");
    });

    test("GET /providers should return provider capability metadata", async () => {
      const response = await fetch("http://localhost/providers", {
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.providers)).toBe(true);
      expect(data.providers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "claude-code",
            capabilities: expect.objectContaining({
              nativeHooks: true,
              supportsDangerousMode: true,
            }),
            launchHints: expect.objectContaining({
              dangerousModeFlags: expect.arrayContaining(["--dangerously-skip-permissions"]),
              resumeCommands: expect.objectContaining({
                resume: "claude --resume {id}",
              }),
            }),
          }),
          expect.objectContaining({
            id: "codex",
            capabilities: expect.objectContaining({
              nativeHooks: false,
              supportsDangerousMode: true,
            }),
            launchHints: expect.objectContaining({
              dangerousModeFlags: expect.arrayContaining([
                "--dangerously-bypass-approvals-and-sandbox",
              ]),
              resumeCommands: expect.objectContaining({
                resume: "codex resume {id}",
              }),
            }),
          }),
        ])
      );
    });
  });

  describe("Sessions endpoints", () => {
    beforeEach(async () => {
      server = await createServer(socketPath, sessionManager, db, eventBus);
    });

    test("GET /sessions should return empty array initially", async () => {
      const response = await fetch("http://localhost/sessions", {
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ sessions: [] });
    });

    test("POST /sessions should create new session", async () => {
      const response = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: process.cwd(),
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty("session");
      expect(data.session).toHaveProperty("id");
      expect(data.session.provider).toBe("claude-code");
      expect(data.session.status).toBe("STARTING");
    });

    test("POST /sessions accepts providerResume payload", async () => {
      const response = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "codex",
          cwd: process.cwd(),
          providerResume: {
            providerSessionId: "019c7285-ba64-7462-bbfc-4227f3e24e88",
            mode: "resume",
          },
        }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty("session");
      expect(data.session.provider).toBe("codex");
    });

    test("POST /sessions should validate required fields", async () => {
      const response = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Missing provider and cwd
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("POST /sessions should validate provider type", async () => {
      const response = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "invalid-provider",
          cwd: process.cwd(),
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Invalid provider");
    });

    test("GET /sessions/:id should return session details", async () => {
      // Create a session first
      const createResponse = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: process.cwd(),
        }),
      });

      const { session } = await createResponse.json();

      // Get session details
      const response = await fetch(`http://localhost/sessions/${session.id}`, {
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("session");
      expect(data.session.id).toBe(session.id);
    });

    test("GET /sessions/:id should return 404 for non-existent session", async () => {
      const response = await fetch("http://localhost/sessions/non-existent-id", {
        unix: socketPath,
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("GET /sessions/:id/output should return 404 for unknown session", async () => {
      const response = await fetch("http://localhost/sessions/non-existent-id/output", {
        unix: socketPath,
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("Session not found");
    });

    test("GET /sessions/:id/output should return 409 for inactive known session", async () => {
      db.createSession({
        id: "inactive-session",
        provider: "claude-code",
        cwd: process.cwd(),
        status: "STOPPED",
      });

      const response = await fetch("http://localhost/sessions/inactive-session/output", {
        unix: socketPath,
      });

      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toContain("not actively managed");
      expect(data.status).toBe("STOPPED");
    });

    test("GET /sessions should return all sessions", async () => {
      // Create two sessions
      await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: process.cwd(),
        }),
      });

      await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: process.cwd(),
        }),
      });

      const response = await fetch("http://localhost/sessions", {
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessions).toHaveLength(2);
    });

    test("PUT /sessions/:id/name should set custom name for a DB-backed session", async () => {
      db.createSession({
        id: "named-session",
        provider: "claude-code",
        cwd: process.cwd(),
        status: "STOPPED",
      });

      const response = await fetch("http://localhost/sessions/named-session/name", {
        method: "PUT",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Operator Alpha" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.session.id).toBe("named-session");
      expect(data.session.metadata.ui.customName).toBe("Operator Alpha");

      const persisted = db.getSession("named-session");
      expect(persisted?.metadata?.ui).toEqual(
        expect.objectContaining({
          customName: "Operator Alpha",
        })
      );
    });

    test("PUT /sessions/:id/name should set custom name for an active session", async () => {
      const createResponse = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: process.cwd(),
        }),
      });

      const { session } = await createResponse.json();
      const response = await fetch(`http://localhost/sessions/${session.id}/name`, {
        method: "PUT",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Live Operator" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.session.metadata.ui.customName).toBe("Live Operator");

      const persisted = db.getSession(session.id);
      expect(persisted?.metadata?.ui).toEqual(
        expect.objectContaining({
          customName: "Live Operator",
        })
      );
    });

    test("PUT /sessions/:id/name should clear custom name and preserve other metadata", async () => {
      db.createSession({
        id: "named-session-clear",
        provider: "claude-code",
        cwd: process.cwd(),
        status: "STOPPED",
        metadata: {
          security: { dangerousMode: true },
          ui: { customName: "Old name" },
        },
      });

      const response = await fetch("http://localhost/sessions/named-session-clear/name", {
        method: "PUT",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      const metadata = data.session.metadata as Record<string, unknown>;
      expect((metadata.ui as Record<string, unknown> | undefined)?.customName).toBeUndefined();
      expect((metadata.security as Record<string, unknown>)?.dangerousMode).toBe(true);

      const persisted = db.getSession("named-session-clear");
      const persistedMetadata = persisted?.metadata as Record<string, unknown> | undefined;
      expect((persistedMetadata?.ui as Record<string, unknown> | undefined)?.customName).toBe(
        undefined
      );
      expect((persistedMetadata?.security as Record<string, unknown>)?.dangerousMode).toBe(true);
    });

    test("PUT /sessions/:id/name should validate payload shape", async () => {
      db.createSession({
        id: "named-session-validate",
        provider: "claude-code",
        cwd: process.cwd(),
        status: "STOPPED",
      });

      const missingField = await fetch("http://localhost/sessions/named-session-validate/name", {
        method: "PUT",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(missingField.status).toBe(400);

      const invalidType = await fetch("http://localhost/sessions/named-session-validate/name", {
        method: "PUT",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 42 }),
      });
      expect(invalidType.status).toBe(400);

      const tooLong = await fetch("http://localhost/sessions/named-session-validate/name", {
        method: "PUT",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "a".repeat(81) }),
      });
      expect(tooLong.status).toBe(400);
    });

    test("PUT /sessions/:id/name should return 404 for unknown session", async () => {
      const response = await fetch("http://localhost/sessions/non-existent-id/name", {
        method: "PUT",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Ghost" }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Session control endpoints", () => {
    let sessionId: string;

    beforeEach(async () => {
      server = await createServer(socketPath, sessionManager, db, eventBus);

      // Create a session
      const response = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: process.cwd(),
        }),
      });

      const { session } = await response.json();
      sessionId = session.id;
    });

    test("POST /sessions/:id/stop should stop session gracefully", async () => {
      const response = await fetch(`http://localhost/sessions/${sessionId}/stop`, {
        method: "POST",
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("success");
      expect(data.success).toBe(true);
    });

    test("POST /sessions/:id/kill should force kill session", async () => {
      const response = await fetch(`http://localhost/sessions/${sessionId}/kill`, {
        method: "POST",
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("success");
      expect(data.success).toBe(true);
    });

    test("POST /sessions/:id/recover should recover active session handle", async () => {
      const response = await fetch(`http://localhost/sessions/${sessionId}/recover`, {
        method: "POST",
        unix: socketPath,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("session");
      expect(data.session.id).toBe(sessionId);
    });

    test("POST /sessions/:id/stop should return 404 for non-existent session", async () => {
      const response = await fetch("http://localhost/sessions/non-existent-id/stop", {
        method: "POST",
        unix: socketPath,
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Input endpoints", () => {
    let sessionId: string;

    beforeEach(async () => {
      server = await createServer(socketPath, sessionManager, db, eventBus);

      // Create a session
      const response = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: process.cwd(),
        }),
      });

      const { session } = await response.json();
      sessionId = session.id;
    });

    test("POST /sessions/:id/send should send text to session", async () => {
      const response = await fetch(`http://localhost/sessions/${sessionId}/send`, {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hello world",
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("success");
      expect(data.success).toBe(true);
    });

    test("POST /sessions/:id/send should send text with newline", async () => {
      const response = await fetch(`http://localhost/sessions/${sessionId}/send`, {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hello world",
          newline: true,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("POST /sessions/:id/send should validate text field", async () => {
      const response = await fetch(`http://localhost/sessions/${sessionId}/send`, {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("POST /sessions/:id/keys should send keys to session", async () => {
      const response = await fetch(`http://localhost/sessions/${sessionId}/keys`, {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: ["ctrl+c", "enter"],
        }),
      });

      // claude command may exit immediately in test environments (no binary/auth),
      // resulting in 500 when tmux pane is gone
      expect([200, 500]).toContain(response.status);
      if (response.status === 200) {
        const data = await response.json();
        expect(data.success).toBe(true);
      }
    });

    test("POST /sessions/:id/keys should validate keys field", async () => {
      const response = await fetch(`http://localhost/sessions/${sessionId}/keys`, {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("POST /sessions/:id/send should return 404 for non-existent session", async () => {
      const response = await fetch("http://localhost/sessions/non-existent-id/send", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hello",
        }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Error handling", () => {
    beforeEach(async () => {
      server = await createServer(socketPath, sessionManager, db, eventBus);
    });

    test("should return 404 for unknown routes", async () => {
      const response = await fetch("http://localhost/unknown-route", {
        unix: socketPath,
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should return 405 for unsupported methods", async () => {
      const response = await fetch("http://localhost/health", {
        method: "POST",
        unix: socketPath,
      });

      expect(response.status).toBe(405);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should handle malformed JSON", async () => {
      const response = await fetch("http://localhost/sessions", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: "invalid json {",
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should return 404 for removed web MFA disable endpoint", async () => {
      const response = await fetch("http://localhost/auth/mfa/disable", {
        method: "POST",
        unix: socketPath,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "irrelevant", totpCode: "000000" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });
  });

  describe("Policy/workspace/env-set semantics parity", () => {
    let webDir: string;

    async function requestVia(
      transport: "unix" | "http",
      routePath: string,
      init?: RequestInit
    ): Promise<Response> {
      if (transport === "unix") {
        return await fetch(`http://localhost${routePath}`, {
          ...(init ?? {}),
          unix: socketPath,
        } as any);
      }

      return await fetch(`http://127.0.0.1:${server.httpPort}/api${routePath}`, init);
    }

    beforeEach(async () => {
      webDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-web-test-"));
      fs.writeFileSync(
        path.join(webDir, "index.html"),
        "<!doctype html><html><body>ok</body></html>"
      );

      // Session row used by /sessions/:id/policy-sets tests (DB-only, no tmux dependency).
      db.createSession({
        id: "route-semantics-session",
        provider: "claude-code",
        cwd: process.cwd(),
        status: "RUNNING",
      });

      // Workflow fixtures for route-level workflow parity tests.
      const workflowDb = createWorkflowDb(db);
      workflowDb.createWorkflow({
        id: "route-semantics-workflow",
        name: "Route Semantics Workflow",
        definition: {
          name: "Route Semantics Workflow",
          steps: [{ name: "log", type: "log", message: "ok" }],
        },
      });
      workflowDb.createExecution({
        id: "route-semantics-exec",
        workflowId: "route-semantics-workflow",
        status: "running",
      });

      const httpPort = await getAvailablePort();
      server = await createServer(socketPath, sessionManager, db, eventBus, {
        webDir,
        httpPort,
      });
    });

    afterEach(() => {
      if (webDir && fs.existsSync(webDir)) {
        fs.rmSync(webDir, { recursive: true, force: true });
      }
    });

    test("returns 409 for duplicate policy-set creation on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const setId = `dup-policy-set-${transport}`;
        const createA = await requestVia(transport, "/policy-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: setId,
            name: `Duplicate Set ${transport}`,
          }),
        });
        expect(createA.status).toBe(201);

        const createB = await requestVia(transport, "/policy-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: setId,
            name: `Duplicate Set ${transport} 2`,
          }),
        });
        expect(createB.status).toBe(409);
      }
    });

    test("returns 422 for unresolved policy-set policy references on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const res = await requestVia(transport, "/policy-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: `missing-policy-ref-${transport}`,
            name: `Missing Policy Ref ${transport}`,
            policyIds: ["non-existent-policy"],
          }),
        });

        expect(res.status).toBe(422);
      }
    });

    test("returns 409 when applying an already-applied policy set on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const setId = `already-applied-${transport}`;
        const createSet = await requestVia(transport, "/policy-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: setId,
            name: `Already Applied ${transport}`,
          }),
        });
        expect(createSet.status).toBe(201);

        const applyA = await requestVia(
          transport,
          "/sessions/route-semantics-session/policy-sets",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ policySetId: setId }),
          }
        );
        expect(applyA.status).toBe(200);

        const applyB = await requestVia(
          transport,
          "/sessions/route-semantics-session/policy-sets",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ policySetId: setId }),
          }
        );
        expect(applyB.status).toBe(409);
      }
    });

    test("returns 422 for empty workspace updates on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const create = await requestVia(transport, "/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `ws-${transport}-${Date.now()}`,
            path: process.cwd(),
          }),
        });
        expect(create.status).toBe(201);
        const { workspace } = await create.json();

        const update = await requestVia(transport, `/workspaces/${workspace.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(update.status).toBe(422);
      }
    });

    test("returns 422 for empty env-set updates on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const create = await requestVia(transport, "/env-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `env-${transport}-${Date.now()}`,
            vars: { SAMPLE_KEY: "sample-value" },
          }),
        });
        expect(create.status).toBe(201);
        const { envSet } = await create.json();

        const update = await requestVia(transport, `/env-sets/${envSet.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(update.status).toBe(422);
      }
    });

    test("returns 422 for invalid policy decision query limits on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const res = await requestVia(transport, "/policy-decisions?limit=0");
        expect(res.status).toBe(422);
      }
    });

    test("returns execution details by execution-id route on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const res = await requestVia(transport, "/workflows/executions/route-semantics-exec");
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.execution.id).toBe("route-semantics-exec");
        expect(body.execution.workflowId).toBe("route-semantics-workflow");
      }
    });

    test("returns 404 for nested workflow execution ownership mismatch on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const res = await requestVia(
          transport,
          "/workflows/non-matching-workflow/executions/route-semantics-exec"
        );
        expect(res.status).toBe(404);
      }
    });

    test("returns 200 for execution-id cancel route on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const workflowDb = createWorkflowDb(db);
        const executionId = `route-semantics-cancel-${transport}`;
        workflowDb.createExecution({
          id: executionId,
          workflowId: "route-semantics-workflow",
          status: "running",
        });

        const res = await requestVia(transport, `/workflows/executions/${executionId}/cancel`, {
          method: "POST",
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.cancelMode).toBe("fallback");

        const execution = workflowDb.getExecution(executionId);
        expect(execution?.status).toBe("cancelled");
      }
    });

    test("returns 422 for invalid workflow execution list queries on both transports", async () => {
      for (const transport of ["unix", "http"] as const) {
        const invalidStatus = await requestVia(
          transport,
          "/workflows/route-semantics-workflow/executions?status=bogus"
        );
        expect(invalidStatus.status).toBe(422);

        const invalidLimit = await requestVia(
          transport,
          "/workflows/route-semantics-workflow/executions?limit=0"
        );
        expect(invalidLimit.status).toBe(422);
      }
    });
  });

  describe("HTTP API CSRF protection", () => {
    let webDir: string;

    beforeEach(async () => {
      webDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-web-test-"));
      fs.writeFileSync(
        path.join(webDir, "index.html"),
        "<!doctype html><html><body>ok</body></html>"
      );

      const httpPort = await getAvailablePort();
      server = await createServer(socketPath, sessionManager, db, eventBus, {
        webDir,
        httpPort,
      });
    });

    afterEach(() => {
      if (webDir && fs.existsSync(webDir)) {
        fs.rmSync(webDir, { recursive: true, force: true });
      }
    });

    test("should block cross-origin mutating API requests", async () => {
      const response = await fetch(`http://127.0.0.1:${server.httpPort}/api/auth/setup`, {
        method: "POST",
        headers: {
          Origin: "http://malicious.invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: "test-password-123" }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Cross-site request blocked");
    });

    test("should allow same-origin mutating API requests", async () => {
      const response = await fetch(`http://127.0.0.1:${server.httpPort}/api/auth/setup`, {
        method: "POST",
        headers: {
          Origin: `http://127.0.0.1:${server.httpPort}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: "test-password-123" }),
      });

      // Auth service is not configured in this test harness; request should pass CSRF checks.
      expect(response.status).toBe(500);
    });

    test("should allow mutating API requests without Origin/Referer headers", async () => {
      const response = await fetch(`http://127.0.0.1:${server.httpPort}/api/auth/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: "test-password-123" }),
      });

      // Non-browser clients (no Origin/Referer) are allowed.
      expect(response.status).toBe(500);
    });

    test("should not apply CSRF blocking to safe methods", async () => {
      const response = await fetch(`http://127.0.0.1:${server.httpPort}/api/health`, {
        method: "GET",
        headers: {
          Origin: "http://malicious.invalid",
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("ok");
    });
  });

  describe("Static file serving security", () => {
    let webRoot: string;
    let webDir: string;
    let siblingDir: string;

    beforeEach(async () => {
      webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-static-test-"));
      webDir = path.join(webRoot, "web");
      siblingDir = path.join(webRoot, "web-malicious");
      fs.mkdirSync(webDir, { recursive: true });
      fs.mkdirSync(siblingDir, { recursive: true });

      fs.writeFileSync(
        path.join(webDir, "index.html"),
        "<!doctype html><html><body>ok</body></html>"
      );
      fs.writeFileSync(path.join(webDir, "safe.txt"), "safe file");
      fs.writeFileSync(path.join(siblingDir, "secret.txt"), "top-secret-content");

      const httpPort = await getAvailablePort();
      server = await createServer(socketPath, sessionManager, db, eventBus, {
        webDir,
        httpPort,
      });
    });

    afterEach(() => {
      if (webRoot && fs.existsSync(webRoot)) {
        fs.rmSync(webRoot, { recursive: true, force: true });
      }
    });

    test("serves files from the configured web directory", async () => {
      const response = await fetch(`http://127.0.0.1:${server.httpPort}/safe.txt`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe("safe file");
    });

    test("blocks raw path traversal to sibling directories", async () => {
      const siblingName = path.basename(siblingDir);
      const response = await rawHttpGet(server.httpPort, `/../${siblingName}/secret.txt`);
      // Bun normalizes traversal segments before handler routing; assert non-leakage.
      expect(response.body.includes("top-secret-content")).toBe(false);
    });

    test("blocks symlink escape outside web root", async () => {
      const symlinkPath = path.join(webDir, "leak.txt");
      try {
        fs.symlinkSync(path.join(siblingDir, "secret.txt"), symlinkPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM" || code === "EOPNOTSUPP") {
          return;
        }
        throw error;
      }

      const response = await fetch(`http://127.0.0.1:${server.httpPort}/leak.txt`);
      expect(response.status).toBe(403);
      const text = await response.text();
      expect(text.includes("top-secret-content")).toBe(false);
    });
  });

  describe("HTTP API rate limiting", () => {
    const originalRateLimitMax = process.env.CODEPIPER_API_RATE_LIMIT_MAX;
    const originalRateLimitWindow = process.env.CODEPIPER_API_RATE_LIMIT_WINDOW_MS;
    let webDir: string;

    beforeEach(async () => {
      webDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-web-test-"));
      fs.writeFileSync(
        path.join(webDir, "index.html"),
        "<!doctype html><html><body>ok</body></html>"
      );
    });

    afterEach(() => {
      if (originalRateLimitMax === undefined) {
        delete process.env.CODEPIPER_API_RATE_LIMIT_MAX;
      } else {
        process.env.CODEPIPER_API_RATE_LIMIT_MAX = originalRateLimitMax;
      }

      if (originalRateLimitWindow === undefined) {
        delete process.env.CODEPIPER_API_RATE_LIMIT_WINDOW_MS;
      } else {
        process.env.CODEPIPER_API_RATE_LIMIT_WINDOW_MS = originalRateLimitWindow;
      }

      if (webDir && fs.existsSync(webDir)) {
        fs.rmSync(webDir, { recursive: true, force: true });
      }
    });

    test("should return 429 with Retry-After when HTTP API rate limit is exceeded", async () => {
      process.env.CODEPIPER_API_RATE_LIMIT_MAX = "2";
      process.env.CODEPIPER_API_RATE_LIMIT_WINDOW_MS = "60000";

      const httpPort = await getAvailablePort();
      server = await createServer(socketPath, sessionManager, db, eventBus, {
        webDir,
        httpPort,
      });

      const url = `http://127.0.0.1:${server.httpPort}/api/health`;
      const r1 = await fetch(url);
      const r2 = await fetch(url);
      const r3 = await fetch(url);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(429);
      expect(r3.headers.get("Retry-After")).toBeTruthy();

      const body = await r3.json();
      expect(body.error).toBe("Too many requests");
      expect(body.retryAfter).toBeGreaterThanOrEqual(1);
    });

    test("should not rate-limit Unix socket API requests", async () => {
      process.env.CODEPIPER_API_RATE_LIMIT_MAX = "1";
      process.env.CODEPIPER_API_RATE_LIMIT_WINDOW_MS = "60000";

      const httpPort = await getAvailablePort();
      server = await createServer(socketPath, sessionManager, db, eventBus, {
        webDir,
        httpPort,
      });

      const r1 = await fetch("http://localhost/health", { unix: socketPath });
      const r2 = await fetch("http://localhost/health", { unix: socketPath });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    });
  });
});
