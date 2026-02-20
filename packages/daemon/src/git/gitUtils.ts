/**
 * GitUtils - Git operations for worktree management and repo inspection
 *
 * Wraps git commands via Bun.spawnSync for worktree management,
 * branch inspection, repo state queries, and diff generation.
 * All functions are async for future-proofing, though the underlying
 * calls are synchronous.
 */

import * as path from "node:path";

export interface GitStatusEntry {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  isUntracked: boolean;
  isRenamed: boolean;
  origPath?: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export interface GitDiffStatEntry {
  path: string;
  additions: number;
  deletions: number;
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a git command synchronously and return parsed output.
 */
function runGit(args: string[], cwd?: string): GitCommandResult {
  const cmdArgs = cwd ? ["-C", cwd, ...args] : args;
  const proc = Bun.spawnSync(["git", ...cmdArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: proc.stdout.toString("utf-8").trimEnd(),
    stderr: proc.stderr.toString("utf-8").trim(),
    exitCode: proc.exitCode,
  };
}

/**
 * Execute a git command and throw on failure.
 */
function runGitOrThrow(args: string[], cwd?: string, errorPrefix?: string): string {
  const result = runGit(args, cwd);
  if (result.exitCode !== 0) {
    const prefix = errorPrefix ?? `git ${args[0]} failed`;
    throw new Error(`${prefix}: ${result.stderr || `exit code ${result.exitCode}`}`);
  }
  return result.stdout;
}

/**
 * Execute a git command and return raw stdout bytes (for binary files).
 */
function runGitRawOrThrow(args: string[], cwd?: string, errorPrefix?: string): Uint8Array {
  const cmdArgs = cwd ? ["-C", cwd, ...args] : args;
  const proc = Bun.spawnSync(["git", ...cmdArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const prefix = errorPrefix ?? `git ${args[0]} failed`;
    throw new Error(`${prefix}: ${proc.stderr.toString("utf-8").trim()}`);
  }
  return new Uint8Array(proc.stdout);
}

function parseNumstatCount(value: string | undefined): number {
  if (!value || value === "-") {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Validate a git ref (commit hash, branch name, tag) to prevent command injection.
 * Allows: alphanumeric, dots, dashes, underscores, slashes, tildes, carets, braces, @
 */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9._\-/~^{}@:]+$/;

export function validateGitRef(ref: string): void {
  if (!ref || ref.length > 256) {
    throw new Error("Invalid git ref: empty or too long");
  }
  if (!SAFE_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid git ref: contains disallowed characters: ${ref}`);
  }
  if (ref.includes("..") && !ref.match(/^[a-f0-9]+\.\.[a-f0-9]+$/)) {
    // Allow commit ranges (abc123..def456) but reject path traversal
    if (ref.includes("../")) {
      throw new Error(`Invalid git ref: path traversal not allowed: ${ref}`);
    }
  }
}

/**
 * Validate a file path to prevent path traversal attacks.
 * Rejects paths containing ".." components.
 */
export function validateFilePath(filePath: string): void {
  if (!filePath) {
    throw new Error("Invalid file path: empty");
  }
  if (filePath.length > 1024) {
    throw new Error("Invalid file path: too long");
  }
  // Reject ".." path components
  const normalized = path.normalize(filePath);
  if (normalized.startsWith("..") || normalized.includes("/../") || normalized.endsWith("/..")) {
    throw new Error(`Invalid file path: path traversal not allowed: ${filePath}`);
  }
  // Reject absolute paths
  if (path.isAbsolute(filePath)) {
    throw new Error(`Invalid file path: absolute paths not allowed: ${filePath}`);
  }
}

export const GitUtils = {
  /**
   * Check if path is inside a git repo.
   */
  async isGitRepo(dirPath: string): Promise<boolean> {
    const result = runGit(["rev-parse", "--is-inside-work-tree"], dirPath);
    return result.exitCode === 0 && result.stdout === "true";
  },

  /**
   * Get root of the git repo containing dirPath.
   */
  async getRepoRoot(dirPath: string): Promise<string> {
    return runGitOrThrow(["rev-parse", "--show-toplevel"], dirPath, "Failed to get repo root");
  },

  /**
   * Get current branch name.
   * Returns "HEAD" if in detached HEAD state.
   */
  async getCurrentBranch(dirPath: string): Promise<string> {
    return runGitOrThrow(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      dirPath,
      "Failed to get current branch"
    );
  },

  /**
   * List all local branches.
   */
  async listBranches(repoPath: string): Promise<string[]> {
    const output = runGitOrThrow(
      ["branch", "--format=%(refname:short)"],
      repoPath,
      "Failed to list branches"
    );
    if (!output) return [];
    return output.split("\n").filter((b) => b.length > 0);
  },

  /**
   * Check if a branch exists locally.
   */
  async branchExists(repoPath: string, branch: string): Promise<boolean> {
    const result = runGit(["rev-parse", "--verify", `refs/heads/${branch}`], repoPath);
    return result.exitCode === 0;
  },

  /**
   * Check if a branch is checked out in any worktree.
   * Returns the worktree path if found.
   */
  async isBranchCheckedOut(
    repoPath: string,
    branch: string
  ): Promise<{ checkedOut: boolean; worktreePath?: string }> {
    const output = runGitOrThrow(
      ["worktree", "list", "--porcelain"],
      repoPath,
      "Failed to list worktrees"
    );

    const targetRef = `refs/heads/${branch}`;
    const lines = output.split("\n");
    let currentWorktreePath: string | undefined;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        currentWorktreePath = line.slice("worktree ".length);
      } else if (line === `branch ${targetRef}`) {
        return { checkedOut: true, worktreePath: currentWorktreePath };
      }
    }

    return { checkedOut: false };
  },

  /**
   * Check for uncommitted changes (staged, unstaged, or untracked).
   */
  async hasUncommittedChanges(repoPath: string): Promise<boolean> {
    const output = runGitOrThrow(
      ["status", "--porcelain"],
      repoPath,
      "Failed to check uncommitted changes"
    );
    return output.length > 0;
  },

  /**
   * Create a git worktree.
   *
   * If createBranch is true, creates a new branch at startPoint (or HEAD).
   * If createBranch is false, checks out an existing branch.
   */
  async createWorktree(opts: {
    repoPath: string;
    worktreePath: string;
    branch: string;
    createBranch: boolean;
    startPoint?: string;
  }): Promise<void> {
    const { repoPath, worktreePath, branch, createBranch, startPoint } = opts;

    if (createBranch) {
      const args = ["worktree", "add", "-b", branch, worktreePath, startPoint ?? "HEAD"];
      runGitOrThrow(args, repoPath, "Failed to create worktree with new branch");
    } else {
      const args = ["worktree", "add", worktreePath, branch];
      runGitOrThrow(args, repoPath, "Failed to create worktree");
    }
  },

  /**
   * Remove a git worktree.
   */
  async removeWorktree(repoPath: string, worktreePath: string, force = false): Promise<void> {
    const args = ["worktree", "remove"];
    if (force) {
      args.push("--force");
    }
    args.push(worktreePath);
    runGitOrThrow(args, repoPath, "Failed to remove worktree");
  },

  /**
   * Stash changes in a worktree before removal.
   * Returns true if changes were stashed, false if working tree was clean.
   */
  async stashChanges(worktreePath: string, sessionId: string): Promise<boolean> {
    const hasChanges = await GitUtils.hasUncommittedChanges(worktreePath);
    if (!hasChanges) {
      return false;
    }

    runGitOrThrow(
      ["stash", "push", "-m", `codepiper-session-${sessionId}`],
      worktreePath,
      "Failed to stash changes"
    );
    return true;
  },

  /**
   * Generate worktree path for a session.
   * Pattern: <repoParentDir>/<repoBasename>-worktrees/<sessionId>/
   */
  getWorktreePath(repoPath: string, sessionId: string): string {
    const parentDir = path.dirname(repoPath);
    const repoName = path.basename(repoPath);
    return path.join(parentDir, `${repoName}-worktrees`, sessionId);
  },

  /**
   * Get working tree status (staged, unstaged, untracked files).
   */
  async getStatus(dirPath: string): Promise<GitStatusEntry[]> {
    const output = runGitOrThrow(
      ["status", "--porcelain=v1", "-uall"],
      dirPath,
      "Failed to get status"
    );
    if (!output) return [];

    const entries: GitStatusEntry[] = [];
    for (const line of output.split("\n")) {
      if (line.length < 4) continue;
      const indexStatus = line[0] ?? "";
      const workTreeStatus = line[1] ?? "";
      const isRenamed = indexStatus === "R" || workTreeStatus === "R";
      let filePath: string;
      let origPath: string | undefined;

      if (isRenamed) {
        const parts = line.slice(3).split(" -> ");
        const fromPath = parts[0] ?? "";
        const toPath = parts[1];
        origPath = fromPath;
        filePath = toPath ?? fromPath;
      } else {
        filePath = line.slice(3);
      }

      entries.push({
        path: filePath,
        indexStatus: indexStatus === " " ? "" : indexStatus,
        workTreeStatus: workTreeStatus === " " ? "" : workTreeStatus,
        isUntracked: indexStatus === "?" && workTreeStatus === "?",
        isRenamed,
        origPath,
      });
    }
    return entries;
  },

  /**
   * Get commit log.
   */
  async getLog(dirPath: string, opts?: { limit?: number; since?: string }): Promise<GitLogEntry[]> {
    const args = ["log", "--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s"];
    if (opts?.limit) {
      args.push(`-n`, String(opts.limit));
    } else {
      args.push("-n", "50");
    }
    if (opts?.since) {
      args.push(`--since=${opts.since}`);
    }

    const output = runGitOrThrow(args, dirPath, "Failed to get log");
    if (!output) return [];

    return output.split("\n").map((line) => {
      const [hash = "", shortHash = "", author = "", email = "", date = "", ...messageParts] =
        line.split("\0");
      return {
        hash,
        shortHash,
        author,
        email,
        date,
        message: messageParts.join("\0"),
      };
    });
  },

  /**
   * Get unified diff for working tree changes or between commits.
   */
  async getDiff(
    dirPath: string,
    opts?: {
      staged?: boolean;
      commitA?: string;
      commitB?: string;
      path?: string;
    }
  ): Promise<string> {
    if (opts?.commitA) validateGitRef(opts.commitA);
    if (opts?.commitB) validateGitRef(opts.commitB);

    const args = ["diff"];

    if (opts?.staged) {
      args.push("--cached");
    } else if (opts?.commitA && opts?.commitB) {
      args.push(opts.commitA, opts.commitB);
    } else if (opts?.commitA) {
      args.push(opts.commitA);
    }

    if (opts?.path) {
      args.push("--", opts.path);
    }

    return runGitOrThrow(args, dirPath, "Failed to get diff");
  },

  /**
   * Get file content at a specific git ref.
   */
  async getFileAtRef(dirPath: string, ref: string, filePath: string): Promise<string> {
    validateGitRef(ref);
    return runGitOrThrow(
      ["show", `${ref}:${filePath}`],
      dirPath,
      `Failed to get file at ref ${ref}`
    );
  },

  /**
   * Get raw file bytes at a specific git ref (for binary files like images).
   * Pre-checks blob size to prevent unbounded memory consumption.
   */
  async getFileAtRefRaw(
    dirPath: string,
    ref: string,
    filePath: string,
    maxBytes = 50 * 1024 * 1024
  ): Promise<Uint8Array> {
    const sizeStr = runGitOrThrow(
      ["cat-file", "-s", `${ref}:${filePath}`],
      dirPath,
      `Failed to get file size at ref ${ref}`
    );
    const sizeBytes = Number.parseInt(sizeStr, 10);
    if (sizeBytes > maxBytes) {
      throw new Error(
        `File too large: ${sizeBytes} bytes (max ${maxBytes}). Refusing to load into memory.`
      );
    }
    return runGitRawOrThrow(
      ["show", `${ref}:${filePath}`],
      dirPath,
      `Failed to get file at ref ${ref}`
    );
  },

  /**
   * Read a file from the working tree on disk.
   */
  async getFileFromWorkingTree(dirPath: string, filePath: string): Promise<string> {
    const repoRoot = path.resolve(dirPath);
    const fullPath = path.resolve(repoRoot, filePath);
    // Ensure resolved path is within the repo directory
    if (!fullPath.startsWith(repoRoot + path.sep)) {
      throw new Error("File path escapes repository directory");
    }
    const file = Bun.file(fullPath);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${filePath}`);
    }
    return file.text();
  },

  /**
   * Stage files.
   */
  async stageFiles(dirPath: string, paths: string[]): Promise<void> {
    runGitOrThrow(["add", "--", ...paths], dirPath, "Failed to stage files");
  },

  /**
   * Unstage files.
   */
  async unstageFiles(dirPath: string, paths: string[]): Promise<void> {
    runGitOrThrow(["reset", "HEAD", "--", ...paths], dirPath, "Failed to unstage files");
  },

  /**
   * Get diff stat (files changed with addition/deletion counts) for a commit.
   */
  async getDiffStat(dirPath: string, ref: string): Promise<GitDiffStatEntry[]> {
    validateGitRef(ref);
    const output = runGitOrThrow(
      ["diff-tree", "--no-commit-id", "-r", "--numstat", ref],
      dirPath,
      "Failed to get diff stat"
    );
    if (!output) return [];

    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [additions, deletions, ...pathParts] = line.split("\t");
        return {
          path: pathParts.join("\t"),
          additions: parseNumstatCount(additions),
          deletions: parseNumstatCount(deletions),
        };
      });
  },

  /**
   * Get diff stat between two refs (e.g., branch comparison).
   * Uses three-dot notation (merge-base) like GitHub PRs.
   */
  async getDiffStatBetweenRefs(
    dirPath: string,
    refA: string,
    refB: string
  ): Promise<GitDiffStatEntry[]> {
    validateGitRef(refA);
    validateGitRef(refB);
    const output = runGitOrThrow(
      ["diff", "--numstat", `${refA}...${refB}`],
      dirPath,
      "Failed to get diff stat between refs"
    );
    if (!output) return [];

    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [additions, deletions, ...pathParts] = line.split("\t");
        return {
          path: pathParts.join("\t"),
          additions: parseNumstatCount(additions),
          deletions: parseNumstatCount(deletions),
        };
      });
  },

  /**
   * Get diff between a commit and its parent (single commit changes).
   */
  async getCommitDiff(dirPath: string, commitHash: string, filePath?: string): Promise<string> {
    const args = ["diff", `${commitHash}^`, commitHash];
    if (filePath) {
      args.push("--", filePath);
    }
    // If commit has no parent (initial commit), use empty tree
    const result = runGit(args, dirPath);
    if (result.exitCode !== 0) {
      // Try against empty tree for initial commit
      const emptyTree = "4b825dc642cb6eb9a060e54bf899d15363da7b23";
      return runGitOrThrow(
        ["diff", emptyTree, commitHash, ...(filePath ? ["--", filePath] : [])],
        dirPath,
        "Failed to get commit diff"
      );
    }
    return result.stdout;
  },
};
