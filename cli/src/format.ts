export function printJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function table(headers: string[], rows: string[][]) {
  if (rows.length === 0) {
    process.stdout.write("No results.\n");
    return;
  }
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]))
      .join("  ")
      .replace(/\s+$/, "");

  process.stdout.write(`${line(headers.map((h) => h.toUpperCase()))}\n`);
  process.stdout.write(`${widths.map((width) => "─".repeat(width)).join("  ")}\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
}

export function kv(entries: [string, string | null | undefined][]) {
  const width = Math.max(...entries.map(([key]) => key.length));
  for (const [key, value] of entries) {
    process.stdout.write(`${key.padEnd(width)}  ${value ?? "—"}\n`);
  }
}

export function shortTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace(".000Z", "Z").slice(0, 19);
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return "—";
  return `${value.slice(0, 3)}…${value.slice(-2)}`;
}

export function heading(text: string) {
  process.stdout.write(`${text}\n`);
}
