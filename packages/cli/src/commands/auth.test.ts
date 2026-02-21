import { describe, expect, test } from "bun:test";
import { parseAuthOptions, parseResetPasswordFlags } from "./auth";

describe("auth command parsing", () => {
  test("parseAuthOptions uses defaults", () => {
    const parsed = parseAuthOptions([]);
    expect(parsed.socket).toBe("/tmp/codepiper.sock");
    expect(parsed.subcommand).toBe("status");
    expect(parsed.args).toEqual([]);
  });

  test("parseAuthOptions parses socket and subcommand args", () => {
    const parsed = parseAuthOptions([
      "--socket",
      "/tmp/custom.sock",
      "reset-password",
      "--generate",
    ]);
    expect(parsed.socket).toBe("/tmp/custom.sock");
    expect(parsed.subcommand).toBe("reset-password");
    expect(parsed.args).toEqual(["--generate"]);
  });

  test("parseResetPasswordFlags detects generate aliases", () => {
    expect(parseResetPasswordFlags(["--generate"]).generate).toBe(true);
    expect(parseResetPasswordFlags(["-g"]).generate).toBe(true);
    expect(parseResetPasswordFlags([]).generate).toBe(false);
  });

  test("parseResetPasswordFlags rejects unknown options", () => {
    expect(() => parseResetPasswordFlags(["--unknown"])).toThrow(
      "Unknown reset-password option: --unknown"
    );
  });
});
