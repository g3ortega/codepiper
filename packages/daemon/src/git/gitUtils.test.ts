import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GitUtils, validateFilePath, validateGitRef } from "./gitUtils";

describe("GitUtils", () => {
  let repoDir: string;
  let tempDir: string;
  const createdWorktrees: string[] = [];

  beforeAll(() => {
    // Create a temporary directory for all tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitutils-test-"));
    repoDir = path.join(tempDir, "test-repo");
    fs.mkdirSync(repoDir, { recursive: true });

    // Initialize git repo
    Bun.spawnSync(["git", "init", "-b", "main"], { cwd: repoDir });
    Bun.spawnSync(["git", "config", "user.email", "test@test.com"], { cwd: repoDir });
    Bun.spawnSync(["git", "config", "user.name", "Test User"], { cwd: repoDir });

    // Create initial commit
    fs.writeFileSync(path.join(repoDir, "README.md"), "# Test Repo\n");
    Bun.spawnSync(["git", "add", "README.md"], { cwd: repoDir });
    Bun.spawnSync(["git", "commit", "-m", "Initial commit"], { cwd: repoDir });

    // Create a test branch
    Bun.spawnSync(["git", "branch", "test-branch"], { cwd: repoDir });
  });

  afterAll(() => {
    // Clean up worktrees first (git requires this before removing repo)
    for (const wt of createdWorktrees) {
      try {
        Bun.spawnSync(["git", "-C", repoDir, "worktree", "remove", "--force", wt]);
      } catch {
        // Best effort cleanup
      }
    }

    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("isGitRepo", () => {
    test("returns true for a git repository", async () => {
      const result = await GitUtils.isGitRepo(repoDir);
      expect(result).toBe(true);
    });

    test("returns false for a non-repo directory", async () => {
      const nonRepoDir = path.join(tempDir, "not-a-repo");
      fs.mkdirSync(nonRepoDir, { recursive: true });
      const result = await GitUtils.isGitRepo(nonRepoDir);
      expect(result).toBe(false);
    });
  });

  describe("getRepoRoot", () => {
    test("returns the root directory of the repo", async () => {
      const root = await GitUtils.getRepoRoot(repoDir);
      // Resolve both to handle symlinks (e.g., /tmp -> /private/tmp on macOS)
      expect(fs.realpathSync(root)).toBe(fs.realpathSync(repoDir));
    });

    test("returns root from a subdirectory", async () => {
      const subDir = path.join(repoDir, "sub", "dir");
      fs.mkdirSync(subDir, { recursive: true });
      const root = await GitUtils.getRepoRoot(subDir);
      expect(fs.realpathSync(root)).toBe(fs.realpathSync(repoDir));
    });

    test("throws for a non-repo directory", async () => {
      const nonRepoDir = path.join(tempDir, "no-repo-root");
      fs.mkdirSync(nonRepoDir, { recursive: true });
      await expect(GitUtils.getRepoRoot(nonRepoDir)).rejects.toThrow("Failed to get repo root");
    });
  });

  describe("getCurrentBranch", () => {
    test("returns the current branch name", async () => {
      const branch = await GitUtils.getCurrentBranch(repoDir);
      expect(branch).toBe("main");
    });
  });

  describe("listBranches", () => {
    test("returns all local branches", async () => {
      const branches = await GitUtils.listBranches(repoDir);
      expect(branches).toContain("main");
      expect(branches).toContain("test-branch");
      expect(branches.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("branchExists", () => {
    test("returns true for an existing branch", async () => {
      const exists = await GitUtils.branchExists(repoDir, "main");
      expect(exists).toBe(true);
    });

    test("returns true for test-branch", async () => {
      const exists = await GitUtils.branchExists(repoDir, "test-branch");
      expect(exists).toBe(true);
    });

    test("returns false for a nonexistent branch", async () => {
      const exists = await GitUtils.branchExists(repoDir, "nonexistent-branch");
      expect(exists).toBe(false);
    });
  });

  describe("isBranchCheckedOut", () => {
    test("detects that main branch is checked out", async () => {
      const result = await GitUtils.isBranchCheckedOut(repoDir, "main");
      expect(result.checkedOut).toBe(true);
      expect(result.worktreePath).toBeDefined();
    });

    test("detects that test-branch is not checked out", async () => {
      const result = await GitUtils.isBranchCheckedOut(repoDir, "test-branch");
      expect(result.checkedOut).toBe(false);
      expect(result.worktreePath).toBeUndefined();
    });

    test("returns false for nonexistent branch", async () => {
      const result = await GitUtils.isBranchCheckedOut(repoDir, "does-not-exist");
      expect(result.checkedOut).toBe(false);
    });
  });

  describe("hasUncommittedChanges", () => {
    test("returns false when working tree is clean", async () => {
      const dirty = await GitUtils.hasUncommittedChanges(repoDir);
      expect(dirty).toBe(false);
    });

    test("returns true after creating an untracked file", async () => {
      const filePath = path.join(repoDir, "untracked.txt");
      fs.writeFileSync(filePath, "untracked content\n");

      try {
        const dirty = await GitUtils.hasUncommittedChanges(repoDir);
        expect(dirty).toBe(true);
      } finally {
        fs.unlinkSync(filePath);
      }
    });

    test("returns true after modifying a tracked file", async () => {
      const filePath = path.join(repoDir, "README.md");
      const original = fs.readFileSync(filePath, "utf-8");
      fs.writeFileSync(filePath, `${original}\nModified\n`);

      try {
        const dirty = await GitUtils.hasUncommittedChanges(repoDir);
        expect(dirty).toBe(true);
      } finally {
        fs.writeFileSync(filePath, original);
      }
    });
  });

  describe("createWorktree and removeWorktree", () => {
    test("creates a worktree for an existing branch", async () => {
      const worktreePath = path.join(tempDir, "wt-existing-branch");
      createdWorktrees.push(worktreePath);

      await GitUtils.createWorktree({
        repoPath: repoDir,
        worktreePath,
        branch: "test-branch",
        createBranch: false,
      });

      // Verify worktree directory exists
      expect(fs.existsSync(worktreePath)).toBe(true);
      // Verify it has the repo contents
      expect(fs.existsSync(path.join(worktreePath, "README.md"))).toBe(true);

      // Verify branch is now checked out in the worktree
      const result = await GitUtils.isBranchCheckedOut(repoDir, "test-branch");
      expect(result.checkedOut).toBe(true);
    });

    test("removes a worktree", async () => {
      const worktreePath = path.join(tempDir, "wt-to-remove");
      const branchName = "branch-for-remove-test";

      // Create a branch and worktree
      await GitUtils.createWorktree({
        repoPath: repoDir,
        worktreePath,
        branch: branchName,
        createBranch: true,
      });
      createdWorktrees.push(worktreePath);

      // Verify it exists
      expect(fs.existsSync(worktreePath)).toBe(true);

      // Remove the worktree
      await GitUtils.removeWorktree(repoDir, worktreePath);

      // Verify it is gone
      expect(fs.existsSync(worktreePath)).toBe(false);
    });

    test("force removes a worktree with modifications", async () => {
      const worktreePath = path.join(tempDir, "wt-force-remove");
      const branchName = "branch-for-force-remove";

      await GitUtils.createWorktree({
        repoPath: repoDir,
        worktreePath,
        branch: branchName,
        createBranch: true,
      });
      createdWorktrees.push(worktreePath);

      // Create uncommitted changes in the worktree
      fs.writeFileSync(path.join(worktreePath, "dirty.txt"), "dirty\n");
      Bun.spawnSync(["git", "add", "dirty.txt"], { cwd: worktreePath });

      // Normal remove should fail
      await expect(GitUtils.removeWorktree(repoDir, worktreePath, false)).rejects.toThrow();

      // Force remove should succeed
      await GitUtils.removeWorktree(repoDir, worktreePath, true);
      expect(fs.existsSync(worktreePath)).toBe(false);
    });
  });

  describe("createWorktree with createBranch", () => {
    test("creates a new branch and worktree", async () => {
      const worktreePath = path.join(tempDir, "wt-new-branch");
      const newBranch = "feature-from-worktree";
      createdWorktrees.push(worktreePath);

      await GitUtils.createWorktree({
        repoPath: repoDir,
        worktreePath,
        branch: newBranch,
        createBranch: true,
      });

      // Verify branch was created
      const exists = await GitUtils.branchExists(repoDir, newBranch);
      expect(exists).toBe(true);

      // Verify worktree directory exists with repo contents
      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(fs.existsSync(path.join(worktreePath, "README.md"))).toBe(true);

      // Verify branch is checked out in the worktree
      const result = await GitUtils.isBranchCheckedOut(repoDir, newBranch);
      expect(result.checkedOut).toBe(true);
      const wtPath = result.worktreePath ?? "";
      expect(fs.realpathSync(wtPath)).toBe(fs.realpathSync(worktreePath));
    });

    test("creates a new branch from a specific start point", async () => {
      const worktreePath = path.join(tempDir, "wt-start-point");
      const newBranch = "feature-from-startpoint";
      createdWorktrees.push(worktreePath);

      await GitUtils.createWorktree({
        repoPath: repoDir,
        worktreePath,
        branch: newBranch,
        createBranch: true,
        startPoint: "main",
      });

      const exists = await GitUtils.branchExists(repoDir, newBranch);
      expect(exists).toBe(true);
      expect(fs.existsSync(worktreePath)).toBe(true);
    });

    test("throws when creating a worktree for nonexistent branch", async () => {
      const worktreePath = path.join(tempDir, "wt-nonexistent");
      createdWorktrees.push(worktreePath);

      await expect(
        GitUtils.createWorktree({
          repoPath: repoDir,
          worktreePath,
          branch: "this-branch-does-not-exist",
          createBranch: false,
        })
      ).rejects.toThrow("Failed to create worktree");
    });
  });

  describe("getWorktreePath", () => {
    test("generates correct path from repo root", () => {
      const sessionId = "abc-123-def";
      const result = GitUtils.getWorktreePath("/home/user/projects/myrepo", sessionId);
      expect(result).toBe("/home/user/projects/myrepo-worktrees/abc-123-def");
    });

    test("handles nested repo paths", () => {
      const sessionId = "session-456";
      const result = GitUtils.getWorktreePath("/opt/repos/org/project", sessionId);
      expect(result).toBe("/opt/repos/org/project-worktrees/session-456");
    });

    test("handles trailing slash in repo path", () => {
      const sessionId = "sess-789";
      // path.basename handles trailing slash correctly
      const result = GitUtils.getWorktreePath("/home/user/repo", sessionId);
      expect(result).toBe("/home/user/repo-worktrees/sess-789");
    });
  });

  describe("stashChanges", () => {
    test("stashes when worktree has uncommitted changes", async () => {
      const worktreePath = path.join(tempDir, "wt-stash-dirty");
      const branchName = "branch-stash-dirty";
      createdWorktrees.push(worktreePath);

      await GitUtils.createWorktree({
        repoPath: repoDir,
        worktreePath,
        branch: branchName,
        createBranch: true,
      });

      // Create uncommitted changes
      fs.writeFileSync(path.join(worktreePath, "stash-test.txt"), "stash me\n");
      Bun.spawnSync(["git", "add", "stash-test.txt"], { cwd: worktreePath });

      const stashed = await GitUtils.stashChanges(worktreePath, "test-session-1");
      expect(stashed).toBe(true);

      // Verify the working tree is now clean
      const dirty = await GitUtils.hasUncommittedChanges(worktreePath);
      expect(dirty).toBe(false);

      // Verify stash exists with our message
      const result = Bun.spawnSync(["git", "stash", "list"], {
        cwd: worktreePath,
        stdout: "pipe",
      });
      const stashList = result.stdout.toString("utf-8");
      expect(stashList).toContain("codepiper-session-test-session-1");
    });

    test("returns false when worktree is clean", async () => {
      const worktreePath = path.join(tempDir, "wt-stash-clean");
      const branchName = "branch-stash-clean";
      createdWorktrees.push(worktreePath);

      await GitUtils.createWorktree({
        repoPath: repoDir,
        worktreePath,
        branch: branchName,
        createBranch: true,
      });

      const stashed = await GitUtils.stashChanges(worktreePath, "test-session-2");
      expect(stashed).toBe(false);
    });
  });
});

describe("validateGitRef", () => {
  test("should accept valid commit hashes", () => {
    expect(() => validateGitRef("abc123")).not.toThrow();
    expect(() => validateGitRef("HEAD")).not.toThrow();
    expect(() => validateGitRef("main")).not.toThrow();
    expect(() => validateGitRef("feature/my-branch")).not.toThrow();
    expect(() => validateGitRef("HEAD~3")).not.toThrow();
    expect(() => validateGitRef("HEAD^2")).not.toThrow();
    expect(() => validateGitRef("v1.0.0")).not.toThrow();
    expect(() => validateGitRef("refs/heads/main")).not.toThrow();
    expect(() => validateGitRef("stash@{0}")).not.toThrow();
  });

  test("should reject shell metacharacters", () => {
    expect(() => validateGitRef("$(whoami)")).toThrow("disallowed characters");
    expect(() => validateGitRef("`id`")).toThrow("disallowed characters");
    expect(() => validateGitRef("main; rm -rf /")).toThrow("disallowed characters");
    expect(() => validateGitRef("main && echo pwned")).toThrow("disallowed characters");
    expect(() => validateGitRef("main | cat /etc/passwd")).toThrow("disallowed characters");
    expect(() => validateGitRef("main\necho")).toThrow("disallowed characters");
  });

  test("should reject empty ref", () => {
    expect(() => validateGitRef("")).toThrow("empty or too long");
  });

  test("should reject excessively long refs", () => {
    expect(() => validateGitRef("a".repeat(257))).toThrow("empty or too long");
  });
});

describe("validateFilePath", () => {
  test("should accept valid relative paths", () => {
    expect(() => validateFilePath("src/main.ts")).not.toThrow();
    expect(() => validateFilePath("README.md")).not.toThrow();
    expect(() => validateFilePath("packages/core/src/types.ts")).not.toThrow();
  });

  test("should reject path traversal", () => {
    expect(() => validateFilePath("../../../etc/passwd")).toThrow("path traversal");
    expect(() => validateFilePath("src/../../secret")).toThrow("path traversal");
  });

  test("should reject absolute paths", () => {
    expect(() => validateFilePath("/etc/passwd")).toThrow("absolute paths");
  });

  test("should reject empty paths", () => {
    expect(() => validateFilePath("")).toThrow("empty");
  });

  test("should reject excessively long paths", () => {
    expect(() => validateFilePath("a".repeat(1025))).toThrow("too long");
  });
});
