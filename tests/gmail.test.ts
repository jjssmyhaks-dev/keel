import assert from "node:assert/strict";
import test from "node:test";
import { gmailRawMessage } from "../src/lib/gmail";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

test("builds a base64url MIME message for a plain email", () => {
  const raw = gmailRawMessage({ to: "client@example.com", subject: "Ticket resolved", body: "Hi there." });
  assert.ok(raw);
  const mime = decode(raw);
  assert.match(mime, /^To: client@example\.com\r\n/);
  assert.match(mime, /\r\nSubject: Ticket resolved\r\n/);
  assert.match(mime, /\r\n\r\nHi there\.$/);
});

test("strips CRLF from address and subject to block header injection", () => {
  const raw = gmailRawMessage({
    to: "client@example.com\r\nBcc: attacker@example.com",
    subject: "Hello\r\nX-Injected: yes",
    body: "Body",
  });
  assert.ok(raw);
  const mime = decode(raw);
  assert.doesNotMatch(mime, /\r\nBcc:/);
  assert.doesNotMatch(mime, /\r\nX-Injected:/);
  assert.match(mime, /To: client@example\.com Bcc: attacker@example\.com\r\n/);
  assert.match(mime, /\r\nSubject: Hello X-Injected: yes\r\n/);
});

test("encodes a non-ASCII subject with RFC 2047", () => {
  const raw = gmailRawMessage({ to: "client@example.com", subject: "Héllo", body: "Body" });
  assert.ok(raw);
  assert.match(decode(raw), /Subject: =\?UTF-8\?B\?SMOpbGxv\?=/);
});

test("returns null when required fields are missing", () => {
  assert.equal(gmailRawMessage({ to: "client@example.com", subject: "Hi", body: "" }), null);
  assert.equal(gmailRawMessage({ subject: "Hi", body: "Body" }), null);
  assert.equal(gmailRawMessage({ to: "client@example.com", body: "Body" }), null);
});
