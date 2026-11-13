import patternData from "./secret-patterns.json";

export type PatternConfidence = "high" | "medium";
export type EnvironmentHint = "live" | "test" | null;

export type SecretPattern = {
  id: string;
  label: string;
  connector: string;
  credentialType: string;
  field: string;
  namePatterns: string[];
  valuePattern: string | null;
  environmentHint: EnvironmentHint;
  confidence: PatternConfidence;
  secret?: boolean;
};

type PatternFile = {
  version: number;
  patterns: SecretPattern[];
  groups: Record<string, string[]>;
};

const DATA = patternData as unknown as PatternFile;

export const SECRET_PATTERN_VERSION = DATA.version;
export const SECRET_PATTERNS: SecretPattern[] = DATA.patterns;
export const CREDENTIAL_GROUPS: Record<string, string[]> = DATA.groups;

const COMPILED = SECRET_PATTERNS.map((pattern) => ({
  pattern,
  names: pattern.namePatterns.map((source) => new RegExp(source, "i")),
  value: pattern.valuePattern ? new RegExp(pattern.valuePattern) : null,
}));

export type ParsedEnvEntry = { key: string; value: string; line: number; endLine: number };

/** Parses dotenv syntax in the browser or a CLI: export, quotes, multi-line values, inline comments. */
export function parseEnv(text: string): ParsedEnvEntry[] {
  const source = text.replace(/^\uFEFF/, "");
  const entries: ParsedEnvEntry[] = [];
  const length = source.length;
  let index = 0;
  let line = 1;

  const skipToNewline = () => {
    while (index < length && source[index] !== "\n") index += 1;
  };

  while (index < length) {
    while (index < length && (source[index] === " " || source[index] === "\t" || source[index] === "\r")) index += 1;
    if (index >= length) break;
    if (source[index] === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (source[index] === "#") {
      skipToNewline();
      continue;
    }

    const startLine = line;

    if (/^export\s/.test(source.slice(index, index + 8))) {
      index += 6;
      while (index < length && (source[index] === " " || source[index] === "\t")) index += 1;
    }

    const keyMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (!keyMatch) {
      skipToNewline();
      continue;
    }
    const key = keyMatch[0];
    index += key.length;
    while (index < length && (source[index] === " " || source[index] === "\t")) index += 1;
    if (source[index] !== "=") {
      skipToNewline();
      continue;
    }
    index += 1;
    while (index < length && (source[index] === " " || source[index] === "\t")) index += 1;

    let value = "";
    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index];
      index += 1;
      while (index < length) {
        const char = source[index];
        if (char === "\\" && quote === '"' && index + 1 < length) {
          const next = source[index + 1];
          value += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
          index += 2;
          continue;
        }
        if (char === quote) {
          index += 1;
          break;
        }
        if (char === "\n") line += 1;
        value += char;
        index += 1;
      }
      while (index < length && (source[index] === " " || source[index] === "\t")) index += 1;
      skipToNewline();
    } else {
      let raw = "";
      while (index < length && source[index] !== "\n") {
        raw += source[index];
        index += 1;
      }
      value = raw.replace(/\s+#.*$/, "").trim();
    }

    entries.push({ key, value, line: startLine, endLine: line });
  }

  return entries;
}

export function shannonEntropy(value: string): number {
  if (!value.length) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export function isHighEntropy(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16) return false;
  if (/^(.)\1+$/.test(trimmed)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((rule) => rule.test(trimmed)).length;
  if (classes < 2) return false;
  return shannonEntropy(trimmed) >= 3.2;
}

const PLACEHOLDERS = new Set([
  "changeme",
  "change-me",
  "change_me",
  "your-key-here",
  "your_key_here",
  "your-token-here",
  "your_token_here",
  "your-secret-here",
  "your_secret_here",
  "example",
  "placeholder",
  "todo",
  "null",
  "undefined",
  "none",
  "secret",
  "password",
  "token",
  "key",
]);

export function isObviousPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (PLACEHOLDERS.has(trimmed.toLowerCase())) return true;
  if (/^(x{3,}|\*{3,}|\.{3,}|-{3,}|_{3,})$/.test(trimmed)) return true;
  if (/^(your|replace|insert|enter|add)[-_ ]?(api[-_ ]?)?(key|token|secret|password|value|here)/i.test(trimmed)) return true;
  if (/^<[^>]+>$/.test(trimmed)) return true;
  if (/^\$\{[^}]+\}$/.test(trimmed)) return true;
  return false;
}

export function isPlaceholder(value: string): boolean {
  if (isObviousPlaceholder(value)) return true;
  const trimmed = value.trim();
  if (/^(https?|ftp):\/\//i.test(trimmed) && !/^[a-z]+:\/\/[^/\s]*@/i.test(trimmed)) return true;
  return false;
}

export function maskedPreview(value: string): string {
  return `${value.slice(0, 4)}… (${value.length} chars)`;
}

export type Classification = {
  patternId: string;
  label: string;
  connector: string;
  credentialType: string;
  field: string;
  confidence: PatternConfidence;
  environmentHint: EnvironmentHint;
  warning?: string;
};

/** Matches a variable name and value against the shared patterns. Value evidence outranks names. */
export function classifyEntry(name: string, value: string): Classification | null {
  const candidate = name.trim();
  let best: Classification | null = null;
  let bestScore = -1;

  for (const { pattern, names, value: valueRule } of COMPILED) {
    const nameHit = candidate.length > 0 && names.some((rule) => rule.test(candidate));
    const valueHit = valueRule ? valueRule.test(value) : false;
    if (!nameHit && !valueHit) continue;

    let confidence: PatternConfidence;
    let warning: string | undefined;
    if (valueHit) {
      confidence = "high";
    } else if (nameHit && valueRule) {
      confidence = "medium";
      warning = `Value does not look like a ${pattern.label}.`;
    } else if (nameHit) {
      confidence = pattern.confidence;
    } else {
      continue;
    }

    const score = (confidence === "high" ? 20 : 10) + (nameHit ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = {
        patternId: pattern.id,
        label: pattern.label,
        connector: pattern.connector,
        credentialType: pattern.credentialType,
        field: pattern.field,
        confidence,
        environmentHint: pattern.environmentHint,
        warning,
      };
    }
  }

  return best;
}

export function unmappedSecret(name: string, value: string): boolean {
  const candidate = name.trim();
  if (!/(^|_)(API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)$/i.test(candidate)) return false;
  if (value.trim().length < 16) return false;
  if (isPlaceholder(value)) return false;
  return isHighEntropy(value);
}

export type EnvFinding = ParsedEnvEntry & {
  kind: "matched" | "unmapped";
  patternId?: string;
  label?: string;
  connector?: string;
  credentialType?: string;
  field?: string;
  confidence?: PatternConfidence;
  environmentHint?: EnvironmentHint;
  warning?: string;
};

/** Parses and classifies an env file. Placeholders are dropped before anything is shown. */
export function detectEnv(text: string): EnvFinding[] {
  const findings: EnvFinding[] = [];
  for (const entry of parseEnv(text)) {
    if (!entry.value || isObviousPlaceholder(entry.value)) continue;
    const match = classifyEntry(entry.key, entry.value);
    if (match) {
      findings.push({
        ...entry,
        kind: "matched",
        patternId: match.patternId,
        label: match.label,
        connector: match.connector,
        credentialType: match.credentialType,
        field: match.field,
        confidence: match.confidence,
        environmentHint: match.environmentHint,
        warning: match.warning,
      });
      continue;
    }
    if (unmappedSecret(entry.key, entry.value)) {
      findings.push({ ...entry, kind: "unmapped", confidence: "medium" });
    }
  }
  return findings;
}

export type FindingGroup = {
  connector: string;
  label: string;
  findings: EnvFinding[];
  fields: Record<string, string>;
  missing: string[];
  complete: boolean;
};

/**
 * Groups findings into one credential per connector. Multi-field connectors need every
 * required manifest field before the group is complete.
 */
export function groupFindings(findings: EnvFinding[]): FindingGroup[] {
  const groups: FindingGroup[] = [];
  const byConnector = new Map<string, EnvFinding[]>();
  const unmatched: EnvFinding[] = [];

  for (const finding of findings) {
    if (finding.kind !== "matched" || !finding.connector || !finding.field) {
      unmatched.push(finding);
      continue;
    }
    const list = byConnector.get(finding.connector) ?? [];
    list.push(finding);
    byConnector.set(finding.connector, list);
  }

  for (const [connector, list] of byConnector) {
    const required = CREDENTIAL_GROUPS[connector];
    if (!required) {
      for (const finding of list) {
        groups.push({
          connector,
          label: finding.label ?? connector,
          findings: [finding],
          fields: { [finding.field as string]: finding.value },
          missing: [],
          complete: true,
        });
      }
      continue;
    }

    const fields: Record<string, string> = {};
    const chosen: EnvFinding[] = [];
    const missing: string[] = [];
    const consumed = new Set<EnvFinding>();
    for (const key of required) {
      const finding = list.find((entry) => entry.field === key && !consumed.has(entry));
      if (!finding) {
        missing.push(key);
        continue;
      }
      consumed.add(finding);
      chosen.push(finding);
      fields[key] = finding.value;
    }
    groups.push({
      connector,
      label: chosen[0]?.label ?? connector,
      findings: chosen,
      fields,
      missing,
      complete: missing.length === 0,
    });
    for (const leftover of list) {
      if (consumed.has(leftover)) continue;
      groups.push({
        connector,
        label: leftover.label ?? connector,
        findings: [leftover],
        fields: { [leftover.field as string]: leftover.value },
        missing: required.filter((key) => leftover.field !== key),
        complete: false,
      });
    }
  }

  for (const finding of unmatched) {
    groups.push({
      connector: "",
      label: finding.label ?? "Unrecognised secret",
      findings: [finding],
      fields: {},
      missing: [],
      complete: false,
    });
  }

  return groups;
}
