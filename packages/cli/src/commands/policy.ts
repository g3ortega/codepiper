import { daemonFetch, daemonJson, daemonPost } from "../lib/api";
import { getOption, getPositional, getSocket } from "../lib/args";
import { colors, formatDate, info, success, table } from "../lib/format";

interface Policy {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  sessionId: string | null;
  rules: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

async function listPolicies(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const sessionId = getOption(args, "session");

  const params = sessionId ? `?sessionId=${sessionId}` : "";
  const data = await daemonJson<{ policies: Policy[] }>(`/policies${params}`, { socket });

  if (data.policies.length === 0) {
    console.log("No policies found.");
    return;
  }

  const rows = data.policies.map((p) => [
    p.id.slice(0, 8),
    p.name,
    p.enabled ? `${colors.green}yes${colors.reset}` : `${colors.gray}no${colors.reset}`,
    String(p.priority),
    p.sessionId ? p.sessionId.slice(0, 8) : `${colors.dim}global${colors.reset}`,
    formatDate(p.createdAt),
  ]);

  console.log(table(["ID", "NAME", "ENABLED", "PRI", "SCOPE", "CREATED"], rows));
  console.log(`\n${colors.bold}Total:${colors.reset} ${data.policies.length} policy(ies)`);
}

async function getPolicy(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("policy ID is required");

  const data = await daemonJson<{ policy: Policy }>(`/policies/${id}`, { socket });
  const p = data.policy;

  console.log(`${colors.bold}Policy ${p.id.slice(0, 8)}${colors.reset}`);
  info("ID", p.id);
  info("Name", p.name);
  if (p.description) info("Description", p.description);
  info(
    "Enabled",
    p.enabled ? `${colors.green}yes${colors.reset}` : `${colors.red}no${colors.reset}`
  );
  info("Priority", String(p.priority));
  info("Scope", p.sessionId ? `session ${p.sessionId.slice(0, 8)}...` : "global");
  info("Created", formatDate(p.createdAt));
  info("Updated", formatDate(p.updatedAt));
  console.log(`\n${colors.bold}Rules:${colors.reset}`);
  console.log(JSON.stringify(p.rules, null, 2));
}

async function createPolicy(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const name = getOption(args, "name");
  const rulesStr = getOption(args, "rules");
  const priority = getOption(args, "priority");
  const sessionId = getOption(args, "session");

  if (!name) throw new Error("--name is required");
  if (!rulesStr) throw new Error("--rules is required (JSON string)");

  let rules: unknown;
  try {
    rules = JSON.parse(rulesStr);
  } catch {
    throw new Error("--rules must be valid JSON");
  }

  const body: Record<string, unknown> = {
    id: crypto.randomUUID(),
    name,
    rules,
    enabled: true,
    priority: priority ? Number.parseInt(priority, 10) : 0,
    sessionId: sessionId ?? null,
  };

  const data = await daemonPost<{ policy: Policy }>("/policies", body, { socket });

  success(
    `Policy created: ${colors.bold}${data.policy.name}${colors.reset} (ID: ${data.policy.id})`
  );
}

async function updatePolicy(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("policy ID is required");

  const body: Record<string, unknown> = {};
  const name = getOption(args, "name");
  const rulesStr = getOption(args, "rules");
  const priority = getOption(args, "priority");
  const enabled = getOption(args, "enabled");

  if (name) body.name = name;
  if (rulesStr) {
    try {
      body.rules = JSON.parse(rulesStr);
    } catch {
      throw new Error("--rules must be valid JSON");
    }
  }
  if (priority) body.priority = Number.parseInt(priority, 10);
  if (enabled !== undefined) body.enabled = enabled === "true";

  if (Object.keys(body).length === 0) {
    throw new Error(
      "at least one field to update is required (--name, --rules, --priority, --enabled)"
    );
  }

  await daemonFetch(`/policies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    socket,
  });

  success(`Policy #${id} updated`);
}

async function deletePolicy(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("policy ID is required");

  await daemonFetch(`/policies/${id}`, { method: "DELETE", socket });

  success(`Policy #${id} deleted`);
}

async function togglePolicy(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const id = getPositional(args, 0);
  if (!id) throw new Error("policy ID is required");

  // Get current state
  const data = await daemonJson<{ policy: Policy }>(`/policies/${id}`, { socket });
  const newEnabled = !data.policy.enabled;

  await daemonFetch(`/policies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: newEnabled }),
    socket,
  });

  const state = newEnabled
    ? `${colors.green}enabled${colors.reset}`
    : `${colors.red}disabled${colors.reset}`;
  success(`Policy #${id} ${state}`);
}

async function defaultPolicyAction(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const action = getPositional(args, 0);

  if (!action) {
    // Show current default
    const data = await daemonJson<{ settings: { defaultPolicyAction: string } }>(
      "/settings/daemon",
      { socket }
    );
    info("Default policy action", data.settings.defaultPolicyAction);
    return;
  }

  if (action !== "ask" && action !== "deny") {
    throw new Error('action must be "ask" or "deny"');
  }

  await daemonFetch("/settings/daemon", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ defaultPolicyAction: action }),
    socket,
  });

  success(`Default policy action set to ${colors.bold}${action}${colors.reset}`);
}

export async function runPolicyCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new Error("subcommand required (list, get, create, update, delete, toggle, default)");
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":
    case "ls":
      return listPolicies(subArgs);
    case "get":
    case "show":
      return getPolicy(subArgs);
    case "create":
    case "add":
      return createPolicy(subArgs);
    case "update":
      return updatePolicy(subArgs);
    case "delete":
    case "rm":
      return deletePolicy(subArgs);
    case "toggle":
      return togglePolicy(subArgs);
    case "default":
      return defaultPolicyAction(subArgs);
    default:
      throw new Error(`Unknown policy subcommand: ${subcommand}`);
  }
}
