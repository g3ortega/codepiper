import { describe, expect, it } from "bun:test";
import {
  CodePiperError,
  InvalidSessionStateError,
  ProviderError,
  SessionNotFoundError,
} from "./errors";

describe("Error Classes", () => {
  describe("CodePiperError", () => {
    it("should create base error with message", () => {
      const error = new CodePiperError("test error");
      expect(error.message).toBe("test error");
      expect(error.name).toBe("CodePiperError");
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("SessionNotFoundError", () => {
    it("should create error with session ID", () => {
      const error = new SessionNotFoundError("session-123");
      expect(error.message).toBe("Session not found: session-123");
      expect(error.name).toBe("SessionNotFoundError");
      expect(error.sessionId).toBe("session-123");
    });
  });

  describe("ProviderError", () => {
    it("should create error with provider ID and message", () => {
      const error = new ProviderError("claude-code", "spawn failed");
      expect(error.message).toBe("[claude-code] spawn failed");
      expect(error.name).toBe("ProviderError");
      expect(error.provider).toBe("claude-code");
    });
  });

  describe("InvalidSessionStateError", () => {
    it("should create error with session ID and expected state", () => {
      const error = new InvalidSessionStateError("session-123", "RUNNING", "STOPPED");
      expect(error.message).toBe(
        "Invalid session state for session-123: expected RUNNING, got STOPPED"
      );
      expect(error.sessionId).toBe("session-123");
      expect(error.expectedState).toBe("RUNNING");
      expect(error.actualState).toBe("STOPPED");
    });
  });
});
