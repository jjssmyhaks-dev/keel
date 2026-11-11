import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export function privateOutboundAllowed() {
  return process.env.AUTHAB_ALLOW_PRIVATE_PROVIDER_HOSTS === "1" && process.env.NODE_ENV !== "production";
}

function ipv4FromHextets(high: string, low: string) {
  const hi = parseInt(high, 16);
  const lo = parseInt(low, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function normalizeHost(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .replace(/%.*$/, "");
}

function embeddedIpv4(address: string): string | null {
  const dotted = address.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const mapped = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) return ipv4FromHextets(mapped[1], mapped[2]);
  const sixToFour = address.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour) return ipv4FromHextets(sixToFour[1], sixToFour[2]);
  return null;
}

export function isPrivateAddress(address: string) {
  const normalized = normalizeHost(address);
  if (isIP(normalized) === 4) {
    const [a, b, c] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (isIP(normalized) !== 6) return false;
  const embedded = embeddedIpv4(normalized);
  if (embedded) return isPrivateAddress(embedded);
  if (normalized === "::" || normalized === "::1") return true;
  if (/^2001:0{0,3}(?::|$)/.test(normalized)) return true;
  if (/^2001:db8(?::|$)/.test(normalized)) return true;
  const firstHextet = parseInt(normalized.split(":")[0] || "0", 16);
  return firstHextet < 0x2000 || firstHextet > 0x3fff;
}

export function privateHostname(hostname: string) {
  const host = normalizeHost(hostname);
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  );
}

/**
 * Synchronous check for a hostname or IP literal. Hostnames that are not
 * fully qualified are rejected because OS search domains can resolve them to
 * internal services.
 */
export function isPrivateHost(hostname: string) {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (privateHostname(host)) return true;
  if (isIP(host) !== 0) return isPrivateAddress(host);
  return !host.includes(".");
}

/**
 * Resolves a hostname and rejects it when any address is private, loopback,
 * link-local or otherwise non-public. The development escape hatch never
 * applies in production.
 */
export async function assertPublicHost(hostname: string, label = "Host") {
  if (privateOutboundAllowed()) return;
  const host = normalizeHost(hostname);
  if (!host) throw new Error(`${label} is required.`);
  if (privateHostname(host)) throw new Error(`${label} must be publicly reachable.`);
  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) throw new Error(`${label} cannot target private or loopback addresses.`);
    return;
  }
  if (!host.includes(".")) throw new Error(`${label} must be a fully-qualified public hostname.`);
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve the ${label.toLowerCase()}.`);
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`${label} cannot resolve to private or loopback addresses.`);
  }
}

/**
 * Blocks SSRF targets for endpoints that are configured at runtime (OAuth
 * token endpoints, JWKS URLs, connector base URLs). The development escape
 * hatch never applies in production.
 */
export async function assertSafeOutboundUrl(raw: string, label = "Endpoint") {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (url.username || url.password) throw new Error(`${label} URLs cannot contain credentials.`);
  const dev = privateOutboundAllowed();
  if (url.protocol !== "https:" && !(url.protocol === "http:" && dev)) {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (dev) return url.toString();
  await assertPublicHost(url.hostname, label);
  return url.toString();
}
