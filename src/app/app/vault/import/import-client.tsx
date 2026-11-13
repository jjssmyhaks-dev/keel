"use client";

import { useMemo, useState, useTransition } from "react";
import { classifyEntry, detectEnv, groupFindings, maskedPreview, type FindingGroup } from "@/lib/secret-patterns";
import { importEnvAction } from "./actions";

export type ConnectorOption = {
  slug: string;
  name: string;
  authTypes: string[];
  defaultAuth: string;
  fields: { key: string; label: string; required: boolean; secret: boolean }[];
};

type Override = { connector?: string; type?: string; include?: boolean };

type Row = {
  key: string;
  group: FindingGroup;
  connector: string;
  option?: ConnectorOption;
  type: string;
  fields: Record<string, string>;
  complete: boolean;
  warnings: string[];
  blocked: string | null;
  include: boolean;
  previews: { name: string; preview: string }[];
  source: string;
};

function buildRow(
  group: FindingGroup,
  index: number,
  override: Override | undefined,
  connectors: ConnectorOption[],
  environmentType: string,
  productionWritable: boolean,
): Row {
  const key = `${index}:${group.findings.map((finding) => finding.key).join("+")}`;
  const connector = override?.connector ?? group.connector;
  const option = connectors.find((entry) => entry.slug === connector);
  const fields: Record<string, string> = {};
  let missing: string[] = [];

  if (option) {
    if (!option.fields.length) {
      const first = group.findings[0];
      if (first) fields.secret = first.value;
      missing = first ? [] : ["secret"];
    } else {
      for (const field of option.fields) {
        if (group.fields[field.key]) {
          fields[field.key] = group.fields[field.key];
          continue;
        }
        const match = group.findings.find((finding) => finding.field === field.key);
        if (match) fields[field.key] = match.value;
      }
      if (!Object.keys(fields).length && group.findings.length === 1) {
        const required = option.fields.filter((field) => field.required);
        if (required.length === 1) fields[required[0].key] = group.findings[0].value;
      }
      missing = option.fields.filter((field) => field.required && !fields[field.key]).map((field) => field.key);
    }
  }

  const detectedType = group.findings[0]?.credentialType;
  const type =
    override?.type ??
    (option && detectedType && option.authTypes.includes(detectedType) ? detectedType : (option?.defaultAuth ?? detectedType ?? ""));

  const warnings = new Set<string>();
  for (const finding of group.findings) {
    if (finding.warning) warnings.add(`${finding.key}: ${finding.warning}`);
  }
  if (!option) {
    warnings.add(
      group.findings.some((finding) => finding.kind === "unmapped")
        ? "Choose a connector for this secret."
        : "Choose a connector.",
    );
  }
  if (option && missing.length) {
    const labels = missing.map((fieldKey) => option.fields.find((field) => field.key === fieldKey)?.label ?? fieldKey);
    warnings.add(`Missing required ${labels.join(", ")}. Add the connection manually or include those variables.`);
  }

  const hints = group.findings.map((finding) => classifyEntry("", finding.value)?.environmentHint ?? finding.environmentHint ?? null);
  const live = hints.includes("live");
  const test = hints.includes("test");
  let blocked: string | null = null;
  if (live && environmentType !== "production") {
    blocked = "This looks like a live key. Switch to the production environment to import it.";
  } else if (live && environmentType === "production" && !productionWritable) {
    blocked = "Only owners and admins can add production connections.";
  } else if (test && environmentType === "production") {
    warnings.add("This is a test key. Production calls will fail against the provider.");
  }

  const complete = Boolean(option) && missing.length === 0 && group.findings.length > 0;
  return {
    key,
    group,
    connector,
    option,
    type,
    fields,
    complete,
    warnings: [...warnings],
    blocked,
    include: override?.include ?? (complete && !blocked),
    previews: group.findings.map((finding) => ({ name: finding.key, preview: maskedPreview(finding.value) })),
    source: group.findings.map((finding) => finding.key).join(" · "),
  };
}

export function ImportClient({
  connectors,
  environmentType,
  productionWritable,
}: {
  connectors: ConnectorOption[];
  environmentType: string;
  productionWritable: boolean;
}) {
  const [text, setText] = useState("");
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => {
    const groups = groupFindings(detectEnv(text));
    return groups.map((group, index) =>
      buildRow(group, index, overrides[`${index}:${group.findings.map((finding) => finding.key).join("+")}`], connectors, environmentType, productionWritable),
    );
  }, [text, overrides, connectors, environmentType, productionWritable]);

  const selected = rows.filter((row) => row.include && row.connector && row.complete && !row.blocked);

  function update(key: string, patch: Override) {
    setOverrides((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 256_000) {
      setError("Keep the file under 256 KB. Large files belong in the CLI scanner.");
      return;
    }
    setError(null);
    setText(await file.text());
  }

  function submit() {
    setError(null);
    if (!selected.length) {
      setError("Tick at least one complete connection.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await importEnvAction(
          selected.map((row) => ({
            connector: row.connector,
            type: row.type,
            variables: row.group.findings.map((finding) => finding.key),
            fields: row.fields,
          })),
        );
        if (result && !result.ok) setError(result.message);
      } catch {
        // A redirect from the server action unmounts this page.
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="border border-black/10 bg-white p-4 dark:border-border dark:bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/60 dark:text-muted-foreground">.env file</p>
            <p className="mt-1 text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
              Parsing happens in this browser. The file text never reaches the server — only the rows you tick are sent.
            </p>
          </div>
          <input
            type="file"
            accept=".env,.env.*,text/plain"
            onChange={(event) => void readFile(event.target.files?.[0])}
            className="max-w-full border border-black/45 bg-[#faf9f6] px-3 py-2 font-mono text-[10px] dark:border-white/40 dark:bg-background"
          />
        </div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          spellCheck={false}
          autoComplete="off"
          placeholder={"Paste a .env file here\n\nSLACK_BOT_TOKEN=xoxb-…\nSTRIPE_SECRET_KEY=sk_live_…"}
          className="mt-3 w-full resize-y border border-black/45 bg-[#faf9f6] px-3 py-2 font-mono text-[12px] outline-none focus:border-black dark:border-white/40 dark:bg-background"
        />
      </div>

      {error ? (
        <div className="border border-[#b3402f]/40 bg-[#b3402f]/[0.06] px-3 py-2 text-[12px] text-[#8c3225] dark:text-[#f0a396]">{error}</div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-black/60 dark:text-muted-foreground">
          {rows.length ? `${rows.length} candidate${rows.length === 1 ? "" : "s"} · ${selected.length} ready` : "No secrets detected yet"}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !selected.length}
          className="border border-black bg-black px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white transition-colors hover:bg-[#eca8d6] hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Sealing…" : `Import ${selected.length || ""} connection${selected.length === 1 ? "" : "s"}`}
        </button>
      </div>

      {rows.length ? (
        <div className="border border-black/10 bg-white dark:border-border dark:bg-card">
          <div className="hidden grid-cols-[44px_1.1fr_1fr_0.7fr_1.4fr] gap-3 border-b border-black/10 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-black/60 lg:grid dark:border-border dark:text-muted-foreground">
            <span>Use</span>
            <span>Variable</span>
            <span>Connector</span>
            <span>Type</span>
            <span>Preview and warnings</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid gap-3 border-b border-black/10 px-4 py-4 last:border-b-0 lg:grid-cols-[44px_1.1fr_1fr_0.7fr_1.4fr] lg:items-start dark:border-border"
            >
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={row.include}
                  disabled={!row.complete || Boolean(row.blocked)}
                  onChange={(event) => update(row.key, { include: event.target.checked })}
                  className="size-4 accent-black dark:accent-white"
                  aria-label={`Import ${row.source}`}
                />
              </div>
              <div className="min-w-0">
                {row.group.findings.map((finding) => (
                  <p key={finding.key} className="truncate font-mono text-[11px]">
                    {finding.key}
                  </p>
                ))}
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-black/60 dark:text-muted-foreground">
                  line {row.group.findings.map((finding) => finding.line).join(", ")} ·{" "}
                  {row.group.findings.some((finding) => finding.kind === "unmapped") ? "unmapped" : row.group.findings[0]?.confidence ?? "detected"}
                </p>
              </div>
              <div>
                <select
                  value={row.connector}
                  onChange={(event) => update(row.key, { connector: event.target.value, type: undefined, include: undefined })}
                  className="w-full border border-black/45 bg-[#faf9f6] px-2 py-1.5 text-[11px] dark:border-white/40 dark:bg-background"
                  aria-label={`Connector for ${row.source}`}
                >
                  <option value="">Choose…</option>
                  {connectors.map((entry) => (
                    <option key={entry.slug} value={entry.slug}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <select
                  value={row.type}
                  disabled={!row.option}
                  onChange={(event) => update(row.key, { type: event.target.value })}
                  className="w-full border border-black/45 bg-[#faf9f6] px-2 py-1.5 text-[11px] disabled:opacity-50 dark:border-white/40 dark:bg-background"
                  aria-label={`Authentication type for ${row.source}`}
                >
                  {row.option ? (
                    row.option.authTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))
                  ) : (
                    <option value="">—</option>
                  )}
                </select>
              </div>
              <div className="min-w-0 space-y-1">
                {row.previews.map((preview) => (
                  <p key={preview.name} className="truncate font-mono text-[10px] text-black/65 dark:text-muted-foreground">
                    {preview.name}: {preview.preview}
                  </p>
                ))}
                {row.warnings.map((warning) => (
                  <p key={warning} className="text-[10px] leading-relaxed text-[#8a5600] dark:text-[#e8b26a]">
                    {warning}
                  </p>
                ))}
                {row.blocked ? (
                  <p className="text-[10px] leading-relaxed text-[#8c3225] dark:text-[#f0a396]">{row.blocked}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-black/15 p-8 text-center dark:border-border">
          <p className="text-[13px] font-medium">Paste or upload a .env file.</p>
          <p className="mx-auto mt-1 max-w-lg text-[11px] leading-relaxed text-black/60 dark:text-muted-foreground">
            Known token formats are matched against {`shared/secret-patterns.json`}. Placeholders, comments and URLs without
            credentials are ignored. Secrets that do not match a known service appear as unmapped so you can pick a connector.
          </p>
        </div>
      )}
    </div>
  );
}
