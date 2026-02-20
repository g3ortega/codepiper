import { describe, expect, it } from "bun:test";
import {
  type KnownProviderId,
  type ProviderId,
  type SessionHandle,
  type SessionStatus,
  SUPPORTED_PROVIDERS,
} from "./types";

describe("Core Types", () => {
  describe("ProviderId", () => {
    it("should accept known provider IDs", () => {
      const validIds: KnownProviderId[] = ["claude-code", "codex"];
      expect(validIds).toHaveLength(SUPPORTED_PROVIDERS.length);
      expect(SUPPORTED_PROVIDERS).toEqual(["claude-code", "codex"]);
    });

    it("allows forward-compatible provider IDs in API-facing types", () => {
      const known: ProviderId = "codex";
      const future: ProviderId = "my-new-provider";
      expect(known).toBe("codex");
      expect(future).toBe("my-new-provider");
    });
  });

  describe("SessionStatus", () => {
    it("should include all required statuses", () => {
      const statuses: SessionStatus[] = [
        "STARTING",
        "RUNNING",
        "NEEDS_PERMISSION",
        "NEEDS_INPUT",
        "STOPPED",
        "CRASHED",
      ];
      expect(statuses).toHaveLength(6);
    });
  });

  describe("SessionHandle", () => {
    it("should have required fields", () => {
      const handle: SessionHandle = {
        id: "test-uuid",
        provider: "claude-code",
        cwd: "/test/path",
        status: "STARTING",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(handle.id).toBe("test-uuid");
      expect(handle.provider).toBe("claude-code");
      expect(handle.cwd).toBe("/test/path");
      expect(handle.status).toBe("STARTING");
    });
  });
});
