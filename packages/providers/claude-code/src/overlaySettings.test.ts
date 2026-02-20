import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateOverlaySettings } from "./overlaySettings";

function extractScriptPath(command: string): string {
  const quoted = command.match(/^sh\s+'(.+)'$/);
  if (quoted) {
    return quoted[1];
  }
  const unquoted = command.match(/^sh\s+(.+)$/);
  if (unquoted) {
    return unquoted[1];
  }
  throw new Error(`Unexpected hook command format: ${command}`);
}

describe("overlaySettings", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codepiper-overlay-test-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("generateOverlaySettings", () => {
    it("should generate settings with hooks configuration", async () => {
      const sessionId = "test-session-123";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
      });

      expect(settingsPath).toBeDefined();
      expect(settingsPath).toContain(sessionId);

      const file = Bun.file(settingsPath);
      expect(await file.exists()).toBe(true);

      const settings = await file.json();
      expect(settings).toBeDefined();
      expect(settings.hooks).toBeDefined();
    });

    it("should configure all hook event types", async () => {
      const sessionId = "test-session-456";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
      });

      const file = Bun.file(settingsPath);
      const settings = await file.json();

      // All hook types should be configured
      expect(settings.hooks.SessionStart).toBeDefined();
      expect(settings.hooks.Notification).toBeDefined();
      expect(settings.hooks.PermissionRequest).toBeDefined();
      expect(settings.hooks.Stop).toBeDefined();
    });

    it("should store socket/session/secret in hook script (not command line)", async () => {
      const sessionId = "test-session-789";
      const socketPath = "/tmp/codepiper-custom.sock";
      const secret = "super-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
      });

      const file = Bun.file(settingsPath);
      const settings = await file.json();

      const hookEntry = settings.hooks.SessionStart[0];
      const hookCommand = hookEntry.hooks[0].command;
      expect(hookCommand).toContain("sh ");
      expect(hookCommand).not.toContain("CODEPIPER_SECRET");
      expect(hookCommand).not.toContain(secret);

      const hookScriptPath = extractScriptPath(hookCommand);
      const hookScript = await Bun.file(hookScriptPath).text();
      expect(hookScript).toContain(`export CODEPIPER_UNIX_SOCK='${socketPath}'`);
      expect(hookScript).toContain(`export CODEPIPER_SESSION='${sessionId}'`);
      expect(hookScript).toContain(`export CODEPIPER_SECRET='${secret}'`);
    });

    it("should use codepiper hook-forward as the handler", async () => {
      const sessionId = "test-session-xyz";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
      });

      const file = Bun.file(settingsPath);
      const settings = await file.json();

      // Check that hook-forward is used
      // New format: hooks.SessionStart is array of hook entries
      const hookEntry = settings.hooks.SessionStart[0];
      const hookCommand = hookEntry.hooks[0].command;
      const hookScriptPath = extractScriptPath(hookCommand);
      const hookScript = await Bun.file(hookScriptPath).text();
      expect(hookScript).toContain("hook-forward");
    });

    it("should create unique settings file per session", async () => {
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const path1 = await generateOverlaySettings({
        sessionId: "session-1",
        socketPath,
        secret,
        outputDir: tempDir,
      });

      const path2 = await generateOverlaySettings({
        sessionId: "session-2",
        socketPath,
        secret,
        outputDir: tempDir,
      });

      expect(path1).not.toBe(path2);
      expect(await Bun.file(path1).exists()).toBe(true);
      expect(await Bun.file(path2).exists()).toBe(true);
    });

    it("should configure hooks to read from stdin", async () => {
      const sessionId = "test-session-stdin";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
      });

      const file = Bun.file(settingsPath);
      const settings = await file.json();

      // Hooks should be configured to read event data from stdin
      // New format: hooks.SessionStart is array of hook entries
      expect(settings.hooks.SessionStart[0].hooks[0].stdin).toBe("event");
      expect(settings.hooks.Notification[0].hooks[0].stdin).toBe("event");
      expect(settings.hooks.Stop[0].hooks[0].stdin).toBe("event");
    });

    it("should configure PermissionRequest to read from stdin and use stdout", async () => {
      const sessionId = "test-session-perm";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
      });

      const file = Bun.file(settingsPath);
      const settings = await file.json();

      // PermissionRequest should read from stdin and write decision to stdout
      // New format: hooks.PermissionRequest is array of hook entries
      expect(settings.hooks.PermissionRequest[0].hooks[0].stdin).toBe("event");
      expect(settings.hooks.PermissionRequest[0].hooks[0].stdout).toBe("context");
    });

    it("should enforce restrictive output directory permissions", async () => {
      const sessionId = "test-session-dir-perm";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      await chmod(tempDir, 0o755);

      await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
      });

      const dirMode = (await stat(tempDir)).mode & 0o777;
      expect(dirMode).toBe(0o700);
    });

    it("should write settings and scripts with restrictive permissions", async () => {
      const sessionId = "test-session-file-perm";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
        enableStatusline: true,
      });

      const settings = await Bun.file(settingsPath).json();
      const hookScriptPath = extractScriptPath(settings.hooks.SessionStart[0].hooks[0].command);
      const statuslineScriptPath = extractScriptPath(settings.statusline.command);

      const settingsMode = (await stat(settingsPath)).mode & 0o777;
      const hookScriptMode = (await stat(hookScriptPath)).mode & 0o777;
      const statuslineScriptMode = (await stat(statuslineScriptPath)).mode & 0o777;

      expect(settingsMode).toBe(0o600);
      expect(hookScriptMode).toBe(0o700);
      expect(statuslineScriptMode).toBe(0o700);
    });

    it("should handle optional statusline configuration", async () => {
      const sessionId = "test-session-statusline";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
        enableStatusline: true,
      });

      const file = Bun.file(settingsPath);
      const settings = await file.json();

      // Statusline should be configured
      expect(settings.statusline).toBeDefined();
      const statuslineScriptPath = extractScriptPath(settings.statusline.command);
      const statuslineScript = await Bun.file(statuslineScriptPath).text();
      expect(statuslineScript).toContain("statusline-forward");
    });

    it("should not include statusline when disabled", async () => {
      const sessionId = "test-session-no-statusline";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
        outputDir: tempDir,
        enableStatusline: false,
      });

      const file = Bun.file(settingsPath);
      const settings = await file.json();

      // Statusline should not be configured
      expect(settings.statusline).toBeUndefined();
    });

    it("should use default output directory when not specified", async () => {
      const sessionId = "test-session-default-dir";
      const socketPath = "/tmp/codepiper.sock";
      const secret = "test-secret";

      const settingsPath = await generateOverlaySettings({
        sessionId,
        socketPath,
        secret,
      });
      const settings = await Bun.file(settingsPath).json();

      expect(settingsPath).toBeDefined();
      expect(await Bun.file(settingsPath).exists()).toBe(true);

      // Clean up
      await rm(settingsPath, { force: true });
      if (settings?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command) {
        await rm(extractScriptPath(settings.hooks.SessionStart[0].hooks[0].command), {
          force: true,
        });
      }
    });
  });
});
