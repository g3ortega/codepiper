/**
 * Tests for daemon settings API routes (including default policy action)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { SessionManager } from "../sessions/sessionManager";
import { createServer, type DaemonServer } from "./server";

describe("Settings Routes", () => {
  let server: DaemonServer;
  let socketPath: string;
  let tempDir: string;
  let db: Database;
  let eventBus: EventBus;
  let sessionManager: SessionManager;
  let restartCalls: number;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-settings-test-"));
    socketPath = path.join(tempDir, "test.sock");

    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();
    sessionManager = new SessionManager(db, eventBus);
    restartCalls = 0;

    server = await createServer(socketPath, sessionManager, db, eventBus, {
      onRestartRequested: () => {
        restartCalls += 1;
      },
    });
  });

  afterEach(async () => {
    if (sessionManager) await sessionManager.stopAll();
    if (server) await server.stop();
    try {
      if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function fetchSocket(urlPath: string, init?: RequestInit) {
    return fetch(`http://localhost${urlPath}`, {
      ...init,
      unix: socketPath,
    } as any);
  }

  describe("GET /settings/daemon", () => {
    test("returns default settings", async () => {
      const res = await fetchSocket("/settings/daemon");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.preserveSessions).toBe(false);
      expect(data.settings.defaultPolicyAction).toBe("ask");
      expect(data.settings.forwardSshAuthSock).toBe(true);
      expect(data.settings.codexHostAccessProfileEnabled).toBe(false);
      expect(data.settings.terminalFeatures.wsPtyPasteEnabled).toBe(true);
      expect(data.settings.terminalFeatures.latencyProbesEnabled).toBe(true);
      expect(data.settings.terminalFeatures.diagnosticsPanelEnabled).toBe(false);
      expect(data.settings.terminalFeatures.codexAppServerSpikeEnabled).toBe(false);
      expect(data.settings.terminalFeatures.wsPtyPasteCanaryPercent).toBe(100);
      expect(data.settings.terminalFeatures.latencyProbesCanaryPercent).toBe(100);
      expect(data.settings.terminalFeatures.diagnosticsPanelCanaryPercent).toBe(0);
      expect(data.settings.notificationsEnabled).toBe(false);
      expect(data.settings.systemNotificationsEnabled).toBe(false);
      expect(data.settings.notificationSoundsEnabled).toBe(true);
      expect(data.settings.notificationEventDefaults).toEqual({});
      expect(data.settings.notificationSoundMap).toEqual({});
    });
  });

  describe("PUT /settings/daemon", () => {
    test("updates preserveSessions", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preserveSessions: true }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.preserveSessions).toBe(true);
      expect(data.settings.defaultPolicyAction).toBe("ask");
    });

    test("updates defaultPolicyAction to deny", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPolicyAction: "deny" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.defaultPolicyAction).toBe("deny");
    });

    test("updates forwardSshAuthSock", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forwardSshAuthSock: false }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.forwardSshAuthSock).toBe(false);
    });

    test("updates codexHostAccessProfileEnabled", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codexHostAccessProfileEnabled: true }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.codexHostAccessProfileEnabled).toBe(true);
    });

    test("updates defaultPolicyAction back to ask", async () => {
      // Set to deny first
      await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPolicyAction: "deny" }),
      });

      // Set back to ask
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPolicyAction: "ask" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.defaultPolicyAction).toBe("ask");
    });

    test("rejects invalid defaultPolicyAction", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPolicyAction: "allow" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("defaultPolicyAction");
    });

    test("rejects invalid preserveSessions type", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preserveSessions: "yes" }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects invalid forwardSshAuthSock type", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forwardSshAuthSock: "yes" }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects invalid codexHostAccessProfileEnabled type", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codexHostAccessProfileEnabled: "yes" }),
      });
      expect(res.status).toBe(400);
    });

    test("rejects invalid notificationsEnabled type", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationsEnabled: "yes" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("notificationsEnabled");
    });

    test("rejects invalid systemNotificationsEnabled type", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemNotificationsEnabled: "yes" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("systemNotificationsEnabled");
    });

    test("rejects invalid notificationSoundsEnabled type", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationSoundsEnabled: "yes" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("notificationSoundsEnabled");
    });

    test("rejects invalid notificationEventDefaults shape", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationEventDefaults: {
            "session.turn_completed": "yes",
          },
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("notificationEventDefaults");
    });

    test("rejects invalid notificationSoundMap shape", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationSoundMap: {
            "session.turn_completed": true,
          },
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("notificationSoundMap");
    });

    test("rejects notificationEventDefaults with too many entries", async () => {
      const tooManyEntries = Object.fromEntries(
        Array.from({ length: 129 }, (_value, index) => [`event.${index}`, index % 2 === 0])
      );

      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationEventDefaults: tooManyEntries,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("at most 128 entries");
    });

    test("rejects notificationSoundMap with empty values", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationSoundMap: {
            default: "",
          },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("must not be empty");
    });

    test("rejects notificationSoundMap values that exceed per-entry byte limit", async () => {
      const tooLargeSoundValue = `data:audio/wav;base64,${"A".repeat(700_001)}`;

      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationSoundMap: {
            default: tooLargeSoundValue,
          },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("at most 700000 bytes");
    });

    test("rejects notificationSoundMap payloads that exceed total byte limit", async () => {
      const mediumSoundValue = `data:audio/wav;base64,${"A".repeat(320_000)}`;

      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationSoundMap: {
            default: mediumSoundValue,
            "session.turn_completed": mediumSoundValue,
            "session.permission_required": mediumSoundValue,
          },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("total payload");
    });

    test("updates both settings at once", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preserveSessions: true,
          defaultPolicyAction: "deny",
          forwardSshAuthSock: false,
          codexHostAccessProfileEnabled: true,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.preserveSessions).toBe(true);
      expect(data.settings.defaultPolicyAction).toBe("deny");
      expect(data.settings.forwardSshAuthSock).toBe(false);
      expect(data.settings.codexHostAccessProfileEnabled).toBe(true);
    });

    test("updates notification settings", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationsEnabled: true,
          systemNotificationsEnabled: true,
          notificationSoundsEnabled: false,
          notificationEventDefaults: {
            "session.turn_completed": true,
            "session.permission_required": false,
          },
          notificationSoundMap: {
            "session.turn_completed": "chime",
          },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.notificationsEnabled).toBe(true);
      expect(data.settings.systemNotificationsEnabled).toBe(true);
      expect(data.settings.notificationSoundsEnabled).toBe(false);
      expect(data.settings.notificationEventDefaults).toEqual({
        "session.turn_completed": true,
        "session.permission_required": false,
      });
      expect(data.settings.notificationSoundMap).toEqual({
        "session.turn_completed": "chime",
      });
    });

    test("updates terminal feature flags and rollout percentages", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminalFeatures: {
            wsPtyPasteEnabled: false,
            latencyProbesEnabled: false,
            diagnosticsPanelEnabled: true,
            codexAppServerSpikeEnabled: true,
            wsPtyPasteCanaryPercent: 45,
            latencyProbesCanaryPercent: 20,
            diagnosticsPanelCanaryPercent: 10,
          },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.settings.terminalFeatures.wsPtyPasteEnabled).toBe(false);
      expect(data.settings.terminalFeatures.latencyProbesEnabled).toBe(false);
      expect(data.settings.terminalFeatures.diagnosticsPanelEnabled).toBe(true);
      expect(data.settings.terminalFeatures.codexAppServerSpikeEnabled).toBe(true);
      expect(data.settings.terminalFeatures.wsPtyPasteCanaryPercent).toBe(45);
      expect(data.settings.terminalFeatures.latencyProbesCanaryPercent).toBe(20);
      expect(data.settings.terminalFeatures.diagnosticsPanelCanaryPercent).toBe(10);
    });

    test("rejects invalid terminal feature rollout percentage", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminalFeatures: {
            wsPtyPasteCanaryPercent: 101,
          },
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("wsPtyPasteCanaryPercent");
    });

    test("rejects invalid JSON", async () => {
      const res = await fetchSocket("/settings/daemon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /settings/daemon/restart", () => {
    test("schedules daemon restart", async () => {
      const res = await fetchSocket("/settings/daemon/restart", {
        method: "POST",
      });
      expect(res.status).toBe(202);
      const data = await res.json();
      expect(data.restarting).toBe(true);
      expect(typeof data.message).toBe("string");
      expect(restartCalls).toBe(1);
    });
  });
});
