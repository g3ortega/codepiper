import { daemonFetch, daemonJson, daemonPost } from "../lib/api";
import { getOption, getPositional, getSocket } from "../lib/args";
import { colors, formatDate, info, success, table } from "../lib/format";

interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

async function listWorkspaces(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const data = await daemonJson<{ workspaces: Workspace[] }>("/workspaces", { socket });

  if (data.workspaces.length === 0) {
    console.log("No workspaces found.");
    return;
  }

  const rows = data.workspaces.map((w) => [
    w.id.slice(0, 8),
    w.name,
    w.path,
    formatDate(w.createdAt),
  ]);

  console.log(table(["ID", "NAME", "PATH", "CREATED"], rows));
  console.log(`\n${colors.bold}Total:${colors.reset} ${data.workspaces.length} workspace(s)`);
}

async function getWorkspace(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("workspace ID is required");

  const data = await daemonJson<{ workspace: Workspace }>(`/workspaces/${id}`, { socket });
  const w = data.workspace;

  console.log(`${colors.bold}Workspace ${w.id.slice(0, 8)}${colors.reset}`);
  info("ID", w.id);
  info("Name", w.name);
  info("Path", w.path);
  info("Created", formatDate(w.createdAt));
  info("Updated", formatDate(w.updatedAt));
}

async function createWorkspace(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const name = getOption(args, "name");
  const wsPath = getOption(args, "path");

  if (!name) throw new Error("--name is required");
  if (!wsPath) throw new Error("--path is required");

  const body: Record<string, unknown> = { name, path: wsPath };

  const data = await daemonPost<{ workspace: Workspace }>("/workspaces", body, { socket });

  success(
    `Workspace created: ${colors.bold}${data.workspace.name}${colors.reset} (ID: ${data.workspace.id})`
  );
}

async function updateWorkspace(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("workspace ID is required");

  const body: Record<string, unknown> = {};
  const name = getOption(args, "name");
  const wsPath = getOption(args, "path");

  if (name) body.name = name;
  if (wsPath) body.path = wsPath;

  if (Object.keys(body).length === 0) {
    throw new Error("at least one field to update is required (--name, --path)");
  }

  await daemonFetch(`/workspaces/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    socket,
  });

  success(`Workspace #${id} updated`);
}

async function deleteWorkspace(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("workspace ID is required");

  await daemonFetch(`/workspaces/${id}`, { method: "DELETE", socket });

  success(`Workspace #${id} deleted`);
}

export async function runWorkspaceCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new Error("subcommand required (list, get, create, update, delete)");
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":
    case "ls":
      return listWorkspaces(subArgs);
    case "get":
    case "show":
      return getWorkspace(subArgs);
    case "create":
      return createWorkspace(subArgs);
    case "update":
      return updateWorkspace(subArgs);
    case "delete":
    case "rm":
      return deleteWorkspace(subArgs);
    default:
      throw new Error(`Unknown workspace subcommand: ${subcommand}`);
  }
}
