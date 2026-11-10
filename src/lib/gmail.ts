export function gmailRawMessage(input: { to?: unknown; subject?: unknown; body?: unknown }) {
  const header = (value: unknown) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  const to = header(input.to);
  const subject = header(input.subject);
  const text = String(input.body ?? "");
  if (!to || !subject || !text) return null;

  const encodedSubject = /^[\x20-\x7E]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const mime = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    text,
  ].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}
