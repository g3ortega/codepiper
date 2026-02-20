import { describe, expect, it } from "bun:test";
import { type Config, getDefaultConfig, loadConfig } from "./config";

describe("Config", () => {
  describe("getDefaultConfig", () => {
    it("should return default configuration", () => {
      const config = getDefaultConfig();

      expect(config.socketPath).toBe("/tmp/codepiper.sock");
      expect(config.dataDir).toContain(".codepiper");
      expect(config.maxSessions).toBe(10);
    });

    it("should use home directory for dataDir", () => {
      const config = getDefaultConfig();
      const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";

      expect(config.dataDir).toContain(homeDir);
    });
  });

  describe("loadConfig", () => {
    it("should merge custom config with defaults", () => {
      const custom: Partial<Config> = {
        maxSessions: 5,
      };

      const config = loadConfig(custom);

      expect(config.maxSessions).toBe(5);
      expect(config.socketPath).toBe("/tmp/codepiper.sock"); // default
    });

    it("should override socket path", () => {
      const custom: Partial<Config> = {
        socketPath: "/custom/path.sock",
      };

      const config = loadConfig(custom);

      expect(config.socketPath).toBe("/custom/path.sock");
    });
  });
});
