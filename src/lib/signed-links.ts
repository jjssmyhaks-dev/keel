import { createHmac, timingSafeEqual } from "node:crypto";
import { cookieSecretBytes } from "./secrets";

const VERSION = "apr1";

function sign(payload: string) {
  return createHmac("sha256", cookieSecretBytes()).update(payload).digest("base64url");
}

export function signApprovalToken(token: string) {
  return `${VERSION}.${token}.${sign(token)}`;
}

export function verifyApprovalLink(link: string): string | null {
  const parts = link.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const token = parts[1];
  const signature = parts[2];
  if (!token || !signature) return null;
  const expected = sign(token);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}

export function approvalUrlFor(token: string) {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/approve/${signApprovalToken(token)}`;
}
