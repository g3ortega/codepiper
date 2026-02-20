export function getFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`);
}

export function getOption(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${flag}` && i + 1 < args.length) {
      const value = args[i + 1];
      if (value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

export function getOptionShort(args: string[], long: string, short?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === `--${long}` || (short && args[i] === `-${short}`)) && i + 1 < args.length) {
      const value = args[i + 1];
      if (value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

export function getAllOptions(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${flag}` && i + 1 < args.length) {
      const value = args[i + 1];
      if (value !== undefined) {
        values.push(value);
      }
    }
  }
  return values;
}

export function getSubcommand(args: string[]): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

export function getPositional(args: string[], index: number): string | undefined {
  let count = 0;
  for (const arg of args) {
    if (!arg.startsWith("-")) {
      if (count === index) return arg;
      count++;
    }
  }
  return undefined;
}

export function getSocket(args: string[]): string {
  return (
    getOptionShort(args, "socket", "s") || process.env.CODEPIPER_SOCKET || "/tmp/codepiper.sock"
  );
}

export function getRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
