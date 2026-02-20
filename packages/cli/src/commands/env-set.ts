import { daemonFetch, daemonJson, daemonPost } from "../lib/api";
import { getOption, getPositional, getRequiredValue, getSocket } from "../lib/args";
import { colors, formatDate, info, success, table } from "../lib/format";

interface EnvSet {
  id: string;
  name: string;
  description?: string;
  maskedVars: Record<string, string>;
  varCount: number;
  createdAt: string;
  updatedAt: string;
}

function parseVars(args: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--var") {
      const pair = getRequiredValue(args, i, "--var");
      i++;
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) {
        throw new Error(`Invalid variable format: ${pair}. Expected KEY=VALUE`);
      }
      vars[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
    }
  }
  return vars;
}

async function listEnvSets(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const data = await daemonJson<{ envSets: EnvSet[] }>("/env-sets", { socket });

  if (data.envSets.length === 0) {
    console.log("No environment sets found.");
    return;
  }

  const rows = data.envSets.map((e) => [
    String(e.id).slice(0, 8),
    e.name,
    String(e.varCount ?? Object.keys(e.maskedVars || {}).length),
    e.description || `${colors.dim}-${colors.reset}`,
    formatDate(e.createdAt),
  ]);

  console.log(table(["ID", "NAME", "VARS", "DESCRIPTION", "CREATED"], rows));
  console.log(`\n${colors.bold}Total:${colors.reset} ${data.envSets.length} env set(s)`);
}

async function getEnvSet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("env-set ID is required");

  const data = await daemonJson<{ envSet: EnvSet }>(`/env-sets/${id}`, { socket });
  const e = data.envSet;

  console.log(`${colors.bold}Env Set #${e.id}${colors.reset}`);
  info("Name", e.name);
  if (e.description) info("Description", e.description);
  info("Created", formatDate(e.createdAt));
  info("Updated", formatDate(e.updatedAt));

  const vars = e.maskedVars || {};
  const keys = Object.keys(vars);
  if (keys.length > 0) {
    console.log(`\n${colors.bold}Variables (masked):${colors.reset}`);
    for (const key of keys) {
      console.log(`  ${colors.cyan}${key}${colors.reset}=${vars[key]}`);
    }
  } else {
    console.log(`\n${colors.dim}No variables defined.${colors.reset}`);
  }
}

async function createEnvSet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const name = getOption(args, "name");
  const description = getOption(args, "description");
  const variables = parseVars(args);

  if (!name) throw new Error("--name is required");
  if (Object.keys(variables).length === 0) {
    throw new Error("at least one --var KEY=VALUE is required");
  }

  const body: Record<string, unknown> = { name, vars: variables };
  if (description) body.description = description;

  const data = await daemonPost<{ envSet: EnvSet }>("/env-sets", body, { socket });

  success(
    `Env set created: ${colors.bold}${data.envSet.name}${colors.reset} (ID: ${data.envSet.id})`
  );
}

async function updateEnvSet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("env-set ID is required");

  const body: Record<string, unknown> = {};
  const name = getOption(args, "name");
  const description = getOption(args, "description");
  const variables = parseVars(args);

  if (name) body.name = name;
  if (description) body.description = description;
  if (Object.keys(variables).length > 0) body.vars = variables;

  if (Object.keys(body).length === 0) {
    throw new Error("at least one field to update is required (--name, --description, --var)");
  }

  await daemonFetch(`/env-sets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    socket,
  });

  success(`Env set #${id} updated`);
}

async function deleteEnvSet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("env-set ID is required");

  await daemonFetch(`/env-sets/${id}`, { method: "DELETE", socket });

  success(`Env set #${id} deleted`);
}

export async function runEnvSetCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new Error("subcommand required (list, get, create, update, delete)");
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":
    case "ls":
      return listEnvSets(subArgs);
    case "get":
    case "show":
      return getEnvSet(subArgs);
    case "create":
      return createEnvSet(subArgs);
    case "update":
      return updateEnvSet(subArgs);
    case "delete":
    case "rm":
      return deleteEnvSet(subArgs);
    default:
      throw new Error(`Unknown env-set subcommand: ${subcommand}`);
  }
}
