import { createInterface } from "node:readline";
import { UsageError, flagBool, type ParsedArgs } from "./args";

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new UsageError("No input on stdin. Pipe the secret, or omit --from-stdin to use a hidden prompt.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const value = Buffer.concat(chunks).toString("utf8").trim();
  if (!value) throw new UsageError("The secret read from stdin is empty.");
  return value;
}

export function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) return readStdin();
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const finish = (error?: Error) => {
      cleanup();
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") return finish(new UsageError("Cancelled."));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function requireYes(args: ParsedArgs, message: string): Promise<void> {
  if (flagBool(args, "yes")) return;
  if (await confirm(message)) return;
  throw new UsageError("Refusing a destructive action without confirmation. Pass --yes in non-interactive runs.");
}

export async function promptText(label: string): Promise<string> {
  if (!process.stdin.isTTY) throw new UsageError(`${label} is required when running non-interactively.`);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve, reject) => {
    rl.question(label, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed) reject(new UsageError("A value is required."));
      else resolve(trimmed);
    });
  });
}
