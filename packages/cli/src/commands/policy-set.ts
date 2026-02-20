import { daemonFetch, daemonJson, daemonPost } from "../lib/api";
import { getFlag, getOption, getPositional, getSocket } from "../lib/args";
import { colors, formatDate, info, success, table } from "../lib/format";

interface PolicySet {
  id: string;
  name: string;
  description?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  policies?: Array<{ id: string; name: string; enabled: boolean; priority: number }>;
}

async function listPolicySets(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const data = await daemonJson<{ policySets: PolicySet[] }>("/policy-sets", { socket });

  if (data.policySets.length === 0) {
    console.log("No policy sets found.");
    return;
  }

  const rows = data.policySets.map((ps) => [
    ps.id.slice(0, 8),
    ps.name,
    ps.isDefault ? `${colors.green}yes${colors.reset}` : "no",
    ps.description || `${colors.dim}-${colors.reset}`,
    formatDate(ps.createdAt),
  ]);

  console.log(table(["ID", "NAME", "DEFAULT", "DESCRIPTION", "CREATED"], rows));
  console.log(`\n${colors.bold}Total:${colors.reset} ${data.policySets.length} policy set(s)`);
}

async function getPolicySet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("policy-set ID is required");

  const data = await daemonJson<{ policySet: PolicySet }>(`/policy-sets/${id}`, { socket });
  const ps = data.policySet;

  console.log(`${colors.bold}Policy Set ${ps.id.slice(0, 8)}${colors.reset}`);
  info("Name", ps.name);
  if (ps.description) info("Description", ps.description);
  info("Default", ps.isDefault ? `${colors.green}yes${colors.reset}` : "no");
  info("Created", formatDate(ps.createdAt));
  info("Updated", formatDate(ps.updatedAt));

  if (ps.policies && ps.policies.length > 0) {
    console.log(`\n${colors.bold}Policies:${colors.reset}`);
    const rows = ps.policies.map((p) => [
      p.id.slice(0, 8),
      p.name,
      p.enabled ? `${colors.green}yes${colors.reset}` : `${colors.gray}no${colors.reset}`,
      String(p.priority),
    ]);
    console.log(table(["ID", "NAME", "ENABLED", "PRI"], rows));
  } else {
    console.log(`\n${colors.dim}No policies in this set.${colors.reset}`);
  }
}

async function createPolicySet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const name = getOption(args, "name");
  const description = getOption(args, "description");
  const isDefault = getFlag(args, "default");

  if (!name) throw new Error("--name is required");

  const body: Record<string, unknown> = {
    id: crypto.randomUUID(),
    name,
  };
  if (description) body.description = description;
  if (isDefault) body.isDefault = true;

  const data = await daemonPost<{ policySet: PolicySet }>("/policy-sets", body, { socket });

  success(
    `Policy set created: ${colors.bold}${data.policySet.name}${colors.reset} (ID: ${data.policySet.id})`
  );
}

async function updatePolicySet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("policy-set ID is required");

  const body: Record<string, unknown> = {};
  const name = getOption(args, "name");
  const description = getOption(args, "description");
  const isDefault = getFlag(args, "default");

  if (name) body.name = name;
  if (description) body.description = description;
  if (isDefault) body.isDefault = true;

  if (Object.keys(body).length === 0) {
    throw new Error("at least one field to update is required (--name, --description, --default)");
  }

  await daemonFetch(`/policy-sets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    socket,
  });

  success(`Policy set #${id} updated`);
}

async function deletePolicySet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("policy-set ID is required");

  await daemonFetch(`/policy-sets/${id}`, { method: "DELETE", socket });

  success(`Policy set #${id} deleted`);
}

async function addPolicyToSet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const setId = getPositional(args, 0);
  const policyId = getPositional(args, 1);

  if (!setId) throw new Error("policy-set ID is required");
  if (!policyId) throw new Error("policy ID is required");

  await daemonPost(`/policy-sets/${setId}/policies`, { policyId }, { socket });

  success(`Policy #${policyId} added to set #${setId}`);
}

async function removePolicyFromSet(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const setId = getPositional(args, 0);
  const policyId = getPositional(args, 1);

  if (!setId) throw new Error("policy-set ID is required");
  if (!policyId) throw new Error("policy ID is required");

  await daemonFetch(`/policy-sets/${setId}/policies/${policyId}`, {
    method: "DELETE",
    socket,
  });

  success(`Policy #${policyId} removed from set #${setId}`);
}

export async function runPolicySetCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new Error(
      "subcommand required (list, get, create, update, delete, add-policy, remove-policy)"
    );
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":
    case "ls":
      return listPolicySets(subArgs);
    case "get":
    case "show":
      return getPolicySet(subArgs);
    case "create":
      return createPolicySet(subArgs);
    case "update":
      return updatePolicySet(subArgs);
    case "delete":
    case "rm":
      return deletePolicySet(subArgs);
    case "add-policy":
      return addPolicyToSet(subArgs);
    case "remove-policy":
      return removePolicyFromSet(subArgs);
    default:
      throw new Error(`Unknown policy-set subcommand: ${subcommand}`);
  }
}
