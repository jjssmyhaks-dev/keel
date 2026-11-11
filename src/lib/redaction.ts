const SENSITIVE_KEY = /token|secret|password|api[-_]?key|private[-_]?key|authorization|credential|signature/i;

function keyMatches(key: string, fields: string[]) {
  return fields.includes(key.toLowerCase()) || SENSITIVE_KEY.test(key);
}

function walk(value: unknown, fields: string[], prefix: string, hits: string[], replace: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, fields, prefix, hits, replace));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (keyMatches(key, fields)) {
        hits.push(path);
        out[key] = "[redacted]";
      } else {
        out[key] = walk(item, fields, path, hits, replace);
      }
    }
    return out;
  }
  return value;
}

export function redactedFieldNames(input: Record<string, unknown>, fields: string[]) {
  const hits: string[] = [];
  walk(input, fields, "", hits, false);
  return [...new Set(hits)];
}

export function redact(input: Record<string, unknown>, fields: string[]) {
  return walk(input, fields, "", [], true) as Record<string, unknown>;
}

export function secretValues(secret: Record<string, unknown>, extraKeys: string[] = []) {
  const values = new Set<string>();
  for (const [key, value] of Object.entries(secret)) {
    if (typeof value !== "string" || value.length < 8) continue;
    if (SENSITIVE_KEY.test(key) || extraKeys.includes(key)) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

export function redactDeep(value: unknown, secrets: string[]): { value: unknown; hits: number } {
  if (!secrets.length) return { value, hits: 0 };
  if (typeof value === "string") {
    let hits = 0;
    let out = value;
    for (const secret of secrets) {
      if (!out.includes(secret)) continue;
      hits += out.split(secret).length - 1;
      out = out.split(secret).join("[redacted]");
    }
    return { value: out, hits };
  }
  if (Array.isArray(value)) {
    let hits = 0;
    const out = value.map((item) => {
      const result = redactDeep(item, secrets);
      hits += result.hits;
      return result.value;
    });
    return { value: out, hits };
  }
  if (value && typeof value === "object") {
    let hits = 0;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = redactDeep(item, secrets);
      out[key] = result.value;
      hits += result.hits;
    }
    return { value: out, hits };
  }
  return { value, hits: 0 };
}
