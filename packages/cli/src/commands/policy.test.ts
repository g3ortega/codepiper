import { describe, expect, test } from "bun:test";
import { runPolicyCommand } from "./policy";

describe("policy command", () => {
  test("requires subcommand", async () => {
    await expect(runPolicyCommand([])).rejects.toThrow("subcommand required");
  });

  test("rejects unknown subcommand", async () => {
    await expect(runPolicyCommand(["unknown"])).rejects.toThrow("Unknown policy subcommand");
  });

  test("get requires policy ID", async () => {
    await expect(runPolicyCommand(["get"])).rejects.toThrow("policy ID is required");
  });

  test("create requires --name", async () => {
    await expect(runPolicyCommand(["create", "--rules", "[]"])).rejects.toThrow(
      "--name is required"
    );
  });

  test("create requires --rules", async () => {
    await expect(runPolicyCommand(["create", "--name", "test"])).rejects.toThrow(
      "--rules is required"
    );
  });

  test("create validates JSON rules", async () => {
    await expect(
      runPolicyCommand(["create", "--name", "test", "--rules", "invalid"])
    ).rejects.toThrow("--rules must be valid JSON");
  });

  test("update requires policy ID", async () => {
    await expect(runPolicyCommand(["update"])).rejects.toThrow("policy ID is required");
  });

  test("update requires at least one field", async () => {
    await expect(runPolicyCommand(["update", "1"])).rejects.toThrow(
      "at least one field to update is required"
    );
  });

  test("delete requires policy ID", async () => {
    await expect(runPolicyCommand(["delete"])).rejects.toThrow("policy ID is required");
  });

  test("toggle requires policy ID", async () => {
    await expect(runPolicyCommand(["toggle"])).rejects.toThrow("policy ID is required");
  });
});
