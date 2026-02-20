import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RouteContext } from "./routes";
import { handleValidateGit, handleValidateSession } from "./validationRoutes";

function runGit(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

describe("Validation API Routes", () => {
  let tempDir: string;
  let repoDir: string;
  let nonRepoDir: string;
  let filePath: string;
  let ctx: RouteContext;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-validation-routes-"));
    repoDir = path.join(tempDir, "repo");
    nonRepoDir = path.join(tempDir, "non-repo");
    filePath = path.join(tempDir, "not-a-dir.txt");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(nonRepoDir, { recursive: true });
    fs.writeFileSync(filePath, "content");

    runGit(repoDir, ["init", "-b", "main"]);
    runGit(repoDir, ["config", "user.email", "test@example.com"]);
    runGit(repoDir, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Repo\n");
    runGit(repoDir, ["add", "README.md"]);
    runGit(repoDir, ["commit", "-m", "Initial commit"]);
    runGit(repoDir, ["branch", "feature-a"]);

    ctx = {
      db: {} as any,
      sessionManager: {} as any,
      eventBus: {} as any,
      policyEngine: {} as any,
      auditLogger: {} as any,
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("POST /sessions/validate rejects invalid body and missing cwd", async () => {
    const invalidJson = await handleValidateSession(
      new Request("http://localhost/sessions/validate", {
        method: "POST",
        body: "{broken",
      }),
      ctx
    );
    expect(invalidJson.status).toBe(400);

    const missingCwd = await handleValidateSession(
      new Request("http://localhost/sessions/validate", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      ctx
    );
    expect(missingCwd.status).toBe(400);
  });

  test("POST /sessions/validate returns invalid for missing path and non-directory path", async () => {
    const missingDirPath = path.join(tempDir, "does-not-exist");
    const missingDirResponse = await handleValidateSession(
      new Request("http://localhost/sessions/validate", {
        method: "POST",
        body: JSON.stringify({ cwd: missingDirPath }),
      }),
      ctx
    );
    expect(missingDirResponse.status).toBe(200);
    const missingDirBody = await missingDirResponse.json();
    expect(missingDirBody.valid).toBe(false);
    expect(missingDirBody.directoryExists).toBe(false);

    const nonDirectoryResponse = await handleValidateSession(
      new Request("http://localhost/sessions/validate", {
        method: "POST",
        body: JSON.stringify({ cwd: filePath }),
      }),
      ctx
    );
    expect(nonDirectoryResponse.status).toBe(200);
    const nonDirectoryBody = await nonDirectoryResponse.json();
    expect(nonDirectoryBody.valid).toBe(false);
    expect(nonDirectoryBody.directoryExists).toBe(true);
    expect(nonDirectoryBody.errors[0]).toContain("not a directory");
  });

  test("POST /sessions/validate includes git metadata and warns on uncommitted changes", async () => {
    fs.writeFileSync(path.join(repoDir, "untracked.txt"), "dirty\n");

    const response = await handleValidateSession(
      new Request("http://localhost/sessions/validate", {
        method: "POST",
        body: JSON.stringify({ cwd: repoDir }),
      }),
      ctx
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.valid).toBe(true);
    expect(body.isGitRepo).toBe(true);
    expect(body.gitInfo).toBeDefined();
    expect(body.gitInfo.hasUncommittedChanges).toBe(true);
    expect(body.warnings).toContain("Repository has uncommitted changes");
  });

  test("POST /sessions/validate-git enforces required fields", async () => {
    const missingCwd = await handleValidateGit(
      new Request("http://localhost/sessions/validate-git", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      ctx
    );
    expect(missingCwd.status).toBe(400);

    const missingBranch = await handleValidateGit(
      new Request("http://localhost/sessions/validate-git", {
        method: "POST",
        body: JSON.stringify({ cwd: repoDir }),
      }),
      ctx
    );
    expect(missingBranch.status).toBe(400);

    const missingCreateBranch = await handleValidateGit(
      new Request("http://localhost/sessions/validate-git", {
        method: "POST",
        body: JSON.stringify({ cwd: repoDir, branch: "feature-a" }),
      }),
      ctx
    );
    expect(missingCreateBranch.status).toBe(400);
  });

  test("POST /sessions/validate-git returns invalid for non-repo cwd", async () => {
    const response = await handleValidateGit(
      new Request("http://localhost/sessions/validate-git", {
        method: "POST",
        body: JSON.stringify({
          cwd: nonRepoDir,
          branch: "feature-a",
          createBranch: false,
        }),
      }),
      ctx
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toEqual(["Not a git repository"]);
  });

  test("POST /sessions/validate-git validates createBranch and checked-out branch constraints", async () => {
    const existingBranchWithCreate = await handleValidateGit(
      new Request("http://localhost/sessions/validate-git", {
        method: "POST",
        body: JSON.stringify({
          cwd: repoDir,
          branch: "feature-a",
          createBranch: true,
        }),
      }),
      ctx
    );
    expect(existingBranchWithCreate.status).toBe(200);
    const existingBody = await existingBranchWithCreate.json();
    expect(existingBody.valid).toBe(false);
    expect(existingBody.errors[0]).toContain("Branch already exists");

    const checkedOutBranch = await handleValidateGit(
      new Request("http://localhost/sessions/validate-git", {
        method: "POST",
        body: JSON.stringify({
          cwd: repoDir,
          branch: "main",
          createBranch: false,
        }),
      }),
      ctx
    );
    expect(checkedOutBranch.status).toBe(200);
    const checkedOutBody = await checkedOutBranch.json();
    expect(checkedOutBody.valid).toBe(false);
    expect(checkedOutBody.branchCheckedOut).toBe(true);
    expect(checkedOutBody.errors.join(" ")).toContain("already checked out");
  });
});
