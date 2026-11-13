import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  classifyEntry,
  detectEnv,
  groupFindings,
  maskedPreview,
  type EnvFinding,
  type FindingGroup,
} from "../../shared/scan-core";

export type ScanFinding = {
  file: string;
  line: number;
  endLine: number;
  name: string;
  value: string;
  preview: string;
  kind: "matched" | "unmapped";
  connector: string;
  label: string;
  confidence: "high" | "medium";
  credentialType: string;
  field: string;
  environmentHint: "live" | "test" | null;
  warning?: string;
  language: "env" | "js" | "python" | "other";
};

export type ScanOptions = {
  paths: string[];
  excludes: string[];
  maxSize: number;
  cwd: string;
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", ".authab"]);
const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "composer.lock",
  "Gemfile.lock",
]);
const JS_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const PY_EXT = new Set([".py"]);
const TEXT_EXT = new Set([
  ".env",
  ".txt",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".ini",
  ".conf",
  ".cfg",
  ".sh",
  ".bash",
  ".zsh",
  ".md",
]);

function normalize(path: string) {
  return path.split(sep).join("/");
}

function globToRegExp(glob: string) {
  const source = normalize(glob);
  let out = "^";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "*") {
      if (source[index + 1] === "*") {
        out += ".*";
        index += 1;
        if (source[index + 1] === "/") index += 1;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if ("\\^$+?.()|{}[]".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return new RegExp(`${out}$`);
}

function isExcluded(relativePath: string, patterns: RegExp[]) {
  const normalized = normalize(relativePath);
  const base = normalized.split("/").pop() ?? normalized;
  return patterns.some((rule) => (normalized.includes("/") ? rule.test(normalized) : rule.test(base)));
}

function languageFor(file: string): ScanFinding["language"] {
  const base = file.split(sep).pop() ?? file;
  if (base === ".env" || base.startsWith(".env.") || base.endsWith(".env")) return "env";
  const extension = extname(base).toLowerCase();
  if (JS_EXT.has(extension)) return "js";
  if (PY_EXT.has(extension)) return "python";
  if (TEXT_EXT.has(extension)) return "env";
  return "other";
}

/** Finds literal secrets in source files that are not dotenv syntax. */
function scanCode(text: string, file: string, language: ScanFinding["language"]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lines = text.split(/\r?\n/);
  const assignment =
    /(?:^|[^\w$])(?:export\s+)?(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*(?::[^="'\n]+)?[:=]\s*(["'`])([^"'`\n]{4,})\2/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = assignment.exec(line);
    if (match) {
      const [, name, , value] = match;
      const classification = classifyEntry(name, value);
      if (classification) {
        findings.push({
          file,
          line: index + 1,
          endLine: index + 1,
          name,
          value,
          preview: maskedPreview(value),
          kind: "matched",
          connector: classification.connector,
          label: classification.label,
          confidence: classification.confidence,
          credentialType: classification.credentialType,
          field: classification.field,
          environmentHint: classification.environmentHint,
          warning: classification.warning,
          language,
        });
        continue;
      }
    }

    const literals = /(["'`])([^"'`\n]{8,})\1/g;
    let literal: RegExpExecArray | null;
    while ((literal = literals.exec(line))) {
      const value = literal[2];
      const classification = classifyEntry("", value);
      if (!classification) continue;
      findings.push({
        file,
        line: index + 1,
        endLine: index + 1,
        name: "",
        value,
        preview: maskedPreview(value),
        kind: "matched",
        connector: classification.connector,
        label: classification.label,
        confidence: "high",
        credentialType: classification.credentialType,
        field: classification.field,
        environmentHint: classification.environmentHint,
        language,
      });
    }
  }
  return findings;
}

function scanEnv(text: string, file: string): ScanFinding[] {
  return detectEnv(text).map((entry) => ({
    file,
    line: entry.line,
    endLine: entry.endLine,
    name: entry.key,
    value: entry.value,
    preview: maskedPreview(entry.value),
    kind: entry.kind,
    connector: entry.connector ?? "",
    label: entry.label ?? "Unrecognised secret",
    confidence: entry.confidence ?? "medium",
    credentialType: entry.credentialType ?? "",
    field: entry.field ?? "",
    environmentHint: entry.environmentHint ?? null,
    warning: entry.warning,
    language: "env" as const,
  }));
}

async function walk(directory: string, options: ScanOptions, excludes: RegExp[], files: string[]) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    const relativePath = relative(options.cwd, full);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || isExcluded(relativePath, excludes)) continue;
      await walk(full, options, excludes, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (LOCKFILES.has(entry.name) || isExcluded(relativePath, excludes)) continue;
    files.push(full);
  }
}

async function scanFile(file: string, options: ScanOptions): Promise<ScanFinding[]> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return [];
  }
  if (!info.isFile() || info.size > options.maxSize) return [];
  let buffer: Buffer;
  try {
    buffer = await readFile(file);
  } catch {
    return [];
  }
  if (buffer.subarray(0, 8192).includes(0)) return [];
  const text = buffer.toString("utf8");
  const relativeFile = normalize(relative(options.cwd, file)) || file;
  const language = languageFor(file);
  if (language === "js" || language === "python") return scanCode(text, relativeFile, language);
  return scanEnv(text, relativeFile);
}

export async function scanPaths(options: ScanOptions): Promise<ScanFinding[]> {
  const excludes = options.excludes.map(globToRegExp);
  const files: string[] = [];
  for (const target of options.paths.length ? options.paths : ["."]) {
    const absolute = resolve(options.cwd, target);
    let info;
    try {
      info = await stat(absolute);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      const relativePath = relative(options.cwd, absolute);
      if (!relativePath || !isExcluded(relativePath, excludes)) {
        await walk(absolute, options, excludes, files);
      }
    } else if (!LOCKFILES.has(absolute.split(sep).pop() ?? "") && !isExcluded(relative(options.cwd, absolute), excludes)) {
      files.push(absolute);
    }
  }

  const findings: ScanFinding[] = [];
  for (const file of files) {
    findings.push(...(await scanFile(file, options)));
  }
  return findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
}

export function findingsToGroups(findings: ScanFinding[]): FindingGroup[] {
  const byFile = new Map<string, ScanFinding[]>();
  for (const finding of findings) {
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }
  const groups: FindingGroup[] = [];
  for (const list of byFile.values()) {
    const envFindings: EnvFinding[] = list.map((finding) => ({
      key: finding.name,
      value: finding.value,
      line: finding.line,
      endLine: finding.endLine,
      kind: finding.kind,
      connector: finding.connector || undefined,
      credentialType: finding.credentialType || undefined,
      field: finding.field || undefined,
      confidence: finding.confidence,
      environmentHint: finding.environmentHint,
      warning: finding.warning,
      label: finding.label,
    }));
    groups.push(...groupFindings(envFindings));
  }
  return groups;
}

export function assertCleanGitTree(root: string, force: boolean) {
  if (force) return;
  const location = resolve(root);
  let inside = "";
  try {
    inside = execFileSync("git", ["-C", location, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    inside = "";
  }
  if (inside !== "true") {
    throw new Error(`--write needs ${location} to be inside a git repository with a clean working tree.`);
  }
  const status = execFileSync("git", ["-C", location, "status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (status.trim()) {
    throw new Error("Refusing --write: the working tree has uncommitted changes. Commit or stash first, or pass --force.");
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function rewriteSources(findings: ScanFinding[], options: { cwd: string; force: boolean }) {
  if (!findings.length) return [] as string[];
  assertCleanGitTree(options.cwd, options.force);

  const byFile = new Map<string, ScanFinding[]>();
  for (const finding of findings) {
    if (!finding.name) continue;
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }

  const rewritten: string[] = [];
  for (const [file, list] of byFile) {
    const absolute = resolve(options.cwd, file);
    let text: string;
    try {
      text = await readFile(absolute, "utf8");
    } catch {
      continue;
    }

    if (list[0].language === "env") {
      const lines = text.split("\n");
      const seen = new Set<number>();
      for (const finding of [...list].sort((left, right) => right.line - left.line)) {
        if (seen.has(finding.line)) continue;
        seen.add(finding.line);
        const count = Math.max(finding.endLine - finding.line + 1, 1);
        lines.splice(finding.line - 1, count, "# moved to the Authab vault");
      }
      text = lines.join("\n");
    } else if (list[0].language === "js" || list[0].language === "python") {
      const lines = text.split("\n");
      for (const finding of list) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(finding.name)) continue;
        const index = finding.line - 1;
        if (!lines[index]) continue;
        const replacement =
          list[0].language === "python" ? `os.environ["${finding.name}"]` : `process.env.${finding.name}`;
        const pattern = new RegExp(`(["'\`])${escapeRegExp(finding.value)}\\1`);
        if (pattern.test(lines[index])) lines[index] = lines[index].replace(pattern, replacement);
      }
      text = lines.join("\n");
    } else {
      continue;
    }

    await writeFile(absolute, text, "utf8");
    rewritten.push(file);
  }
  return rewritten;
}

export function scanRoot(paths: string[], cwd: string) {
  const first = resolve(cwd, paths[0] ?? ".");
  return extname(first) ? dirname(first) : first;
}
