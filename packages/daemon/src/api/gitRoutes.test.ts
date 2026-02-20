import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Database } from "../db/db";
import {
  handleGitDiff,
  handleGitDiffStat,
  handleGitFile,
  handleGitFileRaw,
  handleGitLog,
  handleGitStage,
  handleGitStatus,
  handleGitUnstage,
} from "./gitRoutes";
import type { RouteContext } from "./routes";

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

describe("Git API Routes", () => {
  let db: Database;
  let ctx: RouteContext;
  let tempDir: string;
  let repoDir: string;
  let nonRepoDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepiper-git-routes-"));
    repoDir = path.join(tempDir, "repo");
    nonRepoDir = path.join(tempDir, "plain");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(nonRepoDir, { recursive: true });

    runGit(repoDir, ["init", "-b", "main"]);
    runGit(repoDir, ["config", "user.email", "test@example.com"]);
    runGit(repoDir, ["config", "user.name", "Test User"]);

    fs.writeFileSync(path.join(repoDir, "README.md"), "# Test\n");
    runGit(repoDir, ["add", "README.md"]);
    runGit(repoDir, ["commit", "-m", "Initial commit"]);

    db = new Database(":memory:");
    await db.init();
    db.createSession({
      id: "repo-session",
      provider: "claude-code",
      cwd: repoDir,
      status: "RUNNING",
    });
    db.createSession({
      id: "plain-session",
      provider: "claude-code",
      cwd: nonRepoDir,
      status: "RUNNING",
    });

    ctx = {
      db,
      sessionManager: { getSession: mock(() => undefined) } as any,
      eventBus: {} as any,
      policyEngine: {} as any,
      auditLogger: {} as any,
    };
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("GET /sessions/:id/git/status returns 404 for missing session", async () => {
    const response = await handleGitStatus(
      new Request("http://localhost/git/status"),
      ctx,
      "missing"
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("Session not found");
  });

  test("GET /sessions/:id/git/status returns 400 for non-git session cwd", async () => {
    const response = await handleGitStatus(
      new Request("http://localhost/sessions/plain-session/git/status"),
      ctx,
      "plain-session"
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("not a git repository");
  });

  test("GET /sessions/:id/git/status returns branch and status for git repository", async () => {
    const response = await handleGitStatus(
      new Request("http://localhost/sessions/repo-session/git/status"),
      ctx,
      "repo-session"
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.branch).toBe("string");
    expect(body.status).toBeDefined();
  });

  test("GET /sessions/:id/git/log returns log entries", async () => {
    const response = await handleGitLog(
      new Request("http://localhost/sessions/repo-session/git/log?limit=5"),
      ctx,
      "repo-session"
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.log)).toBe(true);
    expect(body.log.length).toBeGreaterThan(0);
  });

  test("GET /sessions/:id/git/diff rejects invalid commit ref", async () => {
    const response = await handleGitDiff(
      new Request("http://localhost/sessions/repo-session/git/diff?commit=HEAD;rm+-rf+/"),
      ctx,
      "repo-session"
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid git ref");
  });

  test("GET /sessions/:id/git/file rejects missing required query params", async () => {
    const response = await handleGitFile(
      new Request("http://localhost/sessions/repo-session/git/file"),
      ctx,
      "repo-session"
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Missing required query params");
  });

  test("GET /sessions/:id/git/file-raw returns raw bytes for valid path", async () => {
    const response = await handleGitFileRaw(
      new Request("http://localhost/sessions/repo-session/git/file-raw?ref=HEAD&path=README.md"),
      ctx,
      "repo-session"
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    const text = await response.text();
    expect(text).toContain("# Test");
  });

  test("GET /sessions/:id/git/diff-stat requires ref when base is not provided", async () => {
    const response = await handleGitDiffStat(
      new Request("http://localhost/sessions/repo-session/git/diff-stat"),
      ctx,
      "repo-session"
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Missing required query param: ref");
  });

  test("POST /sessions/:id/git/stage validates JSON body", async () => {
    const response = await handleGitStage(
      new Request("http://localhost/sessions/repo-session/git/stage", {
        method: "POST",
        body: "{invalid-json",
      }),
      ctx,
      "repo-session"
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("Invalid JSON");
  });

  test("POST /sessions/:id/git/stage and /git/unstage stage and unstage tracked file paths", async () => {
    fs.writeFileSync(path.join(repoDir, "feature.ts"), "export const x = 1;\n");

    const stageResponse = await handleGitStage(
      new Request("http://localhost/sessions/repo-session/git/stage", {
        method: "POST",
        body: JSON.stringify({ paths: ["feature.ts"] }),
      }),
      ctx,
      "repo-session"
    );
    expect(stageResponse.status).toBe(200);

    const stagedStatus = Bun.spawnSync(["git", "status", "--short"], { cwd: repoDir });
    expect(stagedStatus.stdout.toString()).toContain("A  feature.ts");

    const unstageResponse = await handleGitUnstage(
      new Request("http://localhost/sessions/repo-session/git/unstage", {
        method: "POST",
        body: JSON.stringify({ paths: ["feature.ts"] }),
      }),
      ctx,
      "repo-session"
    );
    expect(unstageResponse.status).toBe(200);

    const unstagedStatus = Bun.spawnSync(["git", "status", "--short"], { cwd: repoDir });
    expect(unstagedStatus.stdout.toString()).toContain("?? feature.ts");
  });
});
