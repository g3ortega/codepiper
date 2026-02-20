// ANSI color codes
export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export function formatStatus(status: string): string {
  switch (status) {
    case "RUNNING":
      return `${colors.green}${status}${colors.reset}`;
    case "STARTING":
      return `${colors.yellow}${status}${colors.reset}`;
    case "STOPPED":
      return `${colors.gray}${status}${colors.reset}`;
    case "CRASHED":
      return `${colors.red}${status}${colors.reset}`;
    case "NEEDS_PERMISSION":
      return `${colors.blue}${status}${colors.reset}`;
    case "NEEDS_INPUT":
      return `${colors.cyan}${status}${colors.reset}`;
    default:
      return status;
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `...${str.slice(-(maxLen - 3))}`;
}

export function table(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] ?? "").length))
  );

  const lines: string[] = [];

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? h.length)).join("  ");
  lines.push(`${colors.bold}${headerLine}${colors.reset}`);
  lines.push(
    colors.dim +
      "─".repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2) +
      colors.reset
  );

  // Rows
  for (const row of rows) {
    const line = row
      .map((cell, i) => {
        const value = cell ?? "";
        const stripped = stripAnsi(value);
        const width = widths[i] ?? stripped.length;
        const padding = width - stripped.length;
        return value + " ".repeat(Math.max(0, padding));
      })
      .join("  ");
    lines.push(line);
  }

  return lines.join("\n");
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes requires matching control chars
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

export function success(msg: string): void {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${colors.red}✗${colors.reset} ${msg}`);
}

export function info(label: string, value: string): void {
  console.log(`  ${colors.dim}${label}:${colors.reset} ${value}`);
}
