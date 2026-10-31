export type FlagValue = string | boolean | string[];

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, FlagValue>;
}

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "json",
  "yes",
  "watch",
  "confirm",
  "from-stdin",
  "quiet",
  "debug",
  "always",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};

  const set = (key: string, value: string | boolean) => {
    const existing = flags[key];
    if (existing === undefined) flags[key] = value;
    else if (Array.isArray(existing)) existing.push(String(value));
    else flags[key] = [String(existing), String(value)];
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    if (BOOLEAN_FLAGS.has(body)) {
      set(body, true);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      set(body, next);
      i += 1;
    } else {
      set(body, true);
    }
  }

  return { positionals, flags };
}

export function flagString(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key];
  if (Array.isArray(value)) return value[value.length - 1];
  if (typeof value === "string") return value;
  return undefined;
}

export function flagBool(args: ParsedArgs, key: string): boolean {
  return args.flags[key] === true;
}

export function flagList(args: ParsedArgs, key: string): string[] {
  const value = args.flags[key];
  if (value === undefined || value === true) return [];
  if (Array.isArray(value)) return value.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export function requireFlag(args: ParsedArgs, key: string, hint: string): string {
  const value = flagString(args, key);
  if (!value) throw new UsageError(`Missing --${key}. ${hint}`);
  return value;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
