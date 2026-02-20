/**
 * Session validation API route handlers
 */

import * as fs from "node:fs";
import { GitUtils } from "../git/gitUtils";
import type { RouteContext } from "./routes";

/**
 * POST /sessions/validate - Full pre-flight validation for session creation
 */
export async function handleValidateSession(req: Request, _ctx: RouteContext): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!body.cwd || typeof body.cwd !== "string") {
    return Response.json({ error: "Missing required field: cwd" }, { status: 400 });
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check directory existence
  const directoryExists = fs.existsSync(body.cwd);
  if (!directoryExists) {
    errors.push(`Directory does not exist: ${body.cwd}`);
    return Response.json({
      valid: false,
      directoryExists: false,
      isGitRepo: false,
      errors,
      warnings,
    });
  }

  // Check if stat shows a directory
  const stat = fs.statSync(body.cwd);
  if (!stat.isDirectory()) {
    errors.push(`Path is not a directory: ${body.cwd}`);
    return Response.json({
      valid: false,
      directoryExists: true,
      isGitRepo: false,
      errors,
      warnings,
    });
  }

  // Check if git repo
  const isGitRepo = await GitUtils.isGitRepo(body.cwd);
  let gitInfo: any;

  if (isGitRepo) {
    try {
      const repoRoot = await GitUtils.getRepoRoot(body.cwd);
      const currentBranch = await GitUtils.getCurrentBranch(body.cwd);
      const branches = await GitUtils.listBranches(body.cwd);
      const hasUncommittedChanges = await GitUtils.hasUncommittedChanges(body.cwd);

      if (hasUncommittedChanges) {
        warnings.push("Repository has uncommitted changes");
      }

      gitInfo = {
        repoRoot,
        currentBranch,
        hasUncommittedChanges,
        branches,
      };
    } catch (err) {
      warnings.push(
        `Could not read git info: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }
  }

  return Response.json({
    valid: errors.length === 0,
    directoryExists: true,
    isGitRepo,
    errors,
    warnings,
    gitInfo,
  });
}

/**
 * POST /sessions/validate-git - Validate git worktree options
 */
export async function handleValidateGit(req: Request, _ctx: RouteContext): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!body.cwd || typeof body.cwd !== "string") {
    return Response.json({ error: "Missing required field: cwd" }, { status: 400 });
  }
  if (!body.branch || typeof body.branch !== "string") {
    return Response.json({ error: "Missing required field: branch" }, { status: 400 });
  }
  if (body.createBranch === undefined) {
    return Response.json({ error: "Missing required field: createBranch" }, { status: 400 });
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate git repo
  const isGitRepo = await GitUtils.isGitRepo(body.cwd);
  if (!isGitRepo) {
    return Response.json({
      valid: false,
      errors: ["Not a git repository"],
      warnings: [],
      branchExists: false,
      branchCheckedOut: false,
      uncommittedChanges: false,
    });
  }

  // Check branch existence
  const branchExists = await GitUtils.branchExists(body.cwd, body.branch);

  // Check if branch is checked out in another worktree
  let branchCheckedOut = false;
  let checkedOutIn: string | undefined;

  if (branchExists) {
    const checkResult = await GitUtils.isBranchCheckedOut(body.cwd, body.branch);
    branchCheckedOut = checkResult.checkedOut;
    checkedOutIn = checkResult.worktreePath;
  }

  // Validate based on createBranch flag
  if (body.createBranch) {
    if (branchExists) {
      errors.push(`Branch already exists: ${body.branch}. Uncheck 'Create branch' to use it.`);
    }
  } else {
    if (!branchExists) {
      errors.push(`Branch does not exist: ${body.branch}. Enable 'Create branch' to create it.`);
    }
    if (branchCheckedOut) {
      errors.push(
        `Branch '${body.branch}' is already checked out${checkedOutIn ? ` in ${checkedOutIn}` : ""}. Choose a different branch or create a new one.`
      );
    }
  }

  // Check uncommitted changes
  const uncommittedChanges = await GitUtils.hasUncommittedChanges(body.cwd);
  if (uncommittedChanges) {
    warnings.push(
      "Repository has uncommitted changes. These will remain in the original working tree."
    );
  }

  return Response.json({
    valid: errors.length === 0,
    errors,
    warnings,
    branchExists,
    branchCheckedOut,
    checkedOutIn,
    uncommittedChanges,
  });
}
