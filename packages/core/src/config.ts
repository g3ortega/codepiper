/**
 * Configuration management for the CodePiper system
 */

import { join } from "node:path";

export interface Config {
  socketPath: string;
  dataDir: string;
  maxSessions: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function getDefaultConfig(): Config {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";

  return {
    socketPath: "/tmp/codepiper.sock",
    dataDir: join(homeDir, ".codepiper"),
    maxSessions: 10,
    logLevel: "info",
  };
}

export function loadConfig(custom?: Partial<Config>): Config {
  return {
    ...getDefaultConfig(),
    ...custom,
  };
}
