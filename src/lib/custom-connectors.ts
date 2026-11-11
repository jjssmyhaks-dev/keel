import { createHash } from "crypto";
import type { CustomConnector } from "@prisma/client";
import { parse as parseYaml } from "yaml";
import { db } from "./db";
import { auditEvent } from "./audit";
import {
  CONNECTOR_MAP,
  SANDBOX_CONNECTOR,
  connector as builtinConnector,
  type AuthMethod,
  type Connector,
  type ConnectorAction,
  type ConnectorInjection,
  type CredentialField,
  type Risk,
} from "./connectors";
import { planFor } from "./plans";
import { isBillingActive } from "./limits";
import { assertSafeOutboundUrl, isPrivateHost } from "./outbound";

export class ConnectorImportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConnectorImportError";
    this.code = code;
  }
}

type Json = Record<string, unknown>;

type StoredInjection = {
  injection: ConnectorInjection;
  authMethods: { type: AuthMethod; label: string }[];
  defaultAuth: AuthMethod;
  redactedFields: string[];
};

export type ImportResult = {
  connector: CustomConnector;
  compiled: Connector;
  version: number;
  unchanged: boolean;
  warnings: string[];
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const RISK_VALUES: Risk[] = ["read", "write", "destructive", "financial", "admin"];
const COLORS = ["#25567a", "#2f7d5c", "#7a3db8", "#a56b18", "#b3402f", "#3a3a3a"];
const MAX_SPEC_BYTES = 1024 * 1024;
const MAX_ACTIONS = 100;

const DESTRUCTIVE_WORDS = /delete|remove|revoke|destroy|terminate|purge|cancel|wipe/i;
const FINANCIAL_WORDS = /refund|payment|charge|payout|transfer|disburse|withdraw|invoice|billing|subscription|price|credit/i;
const ADMIN_WORDS = /admin|role|permission|member|invite|api[-_]?key|secret|credential|webhook|setting|token|private[-_]?key/i;
const SENSITIVE_READ_WORDS = /secret|token|credential|private[-_]?key|api[-_]?key/i;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function decodePointerToken(token: string) {
  return decodeURIComponent(token).replace(/~1/g, "/").replace(/~0/g, "~");
}

function resolvePointer(doc: Json, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    throw new ConnectorImportError(
      "unsupported_ref",
      `Only local $ref pointers are supported. "${ref}" points outside this document.`,
    );
  }
  let current: unknown = doc;
  for (const token of ref.slice(2).split("/").map(decodePointerToken)) {
    const node = asObject(current);
    if (!node || !(token in node)) {
      throw new ConnectorImportError("broken_ref", `The spec references "${ref}", which does not exist.`);
    }
    current = node[token];
  }
  return current;
}

function deref(doc: Json, input: unknown, seen: Set<string> = new Set()): unknown {
  let node = input;
  for (let depth = 0; depth < 20; depth += 1) {
    const obj = asObject(node);
    const ref = obj ? text(obj.$ref) : "";
    if (!obj || !ref) return node;
    if (seen.has(ref)) {
      throw new ConnectorImportError("circular_ref", `Circular $ref detected at "${ref}".`);
    }
    seen.add(ref);
    const resolved = asObject(resolvePointer(doc, ref));
    if (!resolved) return node;
    const { $ref: _ref, ...siblings } = obj;
    node = Object.keys(siblings).length ? { ...resolved, ...siblings } : resolved;
  }
  throw new ConnectorImportError("circular_ref", "The spec nests $ref pointers too deeply.");
}

export function parseOpenApiSpec(specText: string): Json {
  const trimmed = specText.trim();
  if (!trimmed) throw new ConnectorImportError("empty_spec", "Paste an OpenAPI 3 document first.");
  if (Buffer.byteLength(trimmed, "utf8") > MAX_SPEC_BYTES) {
    throw new ConnectorImportError("spec_too_large", "OpenAPI documents are limited to 1 MB.");
  }
  let parsed: unknown;
  if (trimmed.startsWith("{")) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new ConnectorImportError("invalid_spec", `The JSON could not be parsed: ${(error as Error).message}`);
    }
  } else {
    try {
      parsed = parseYaml(trimmed);
    } catch (error) {
      throw new ConnectorImportError("invalid_spec", `The YAML could not be parsed: ${(error as Error).message}`);
    }
  }
  const doc = asObject(parsed);
  if (!doc) throw new ConnectorImportError("invalid_spec", "The document must be an OpenAPI object.");
  if (doc.swagger) {
    throw new ConnectorImportError(
      "swagger_unsupported",
      "Swagger 2.0 is not supported. Convert the document to OpenAPI 3.0 or 3.1 first.",
    );
  }
  if (!text(doc.openapi).startsWith("3.")) {
    throw new ConnectorImportError("openapi_required", "Set the document's openapi field to 3.0.x or 3.1.x.");
  }
  if (!asObject(doc.paths)) {
    throw new ConnectorImportError("paths_required", "The spec has no paths object, so there are no actions to import.");
  }
  return doc;
}

function serverInfo(doc: Json, overrideBaseUrl?: string) {
  if (overrideBaseUrl?.trim()) {
    let url: URL;
    try {
      url = new URL(overrideBaseUrl.trim());
    } catch {
      throw new ConnectorImportError("invalid_base_url", "baseUrl must be an absolute HTTPS URL.");
    }
    if (url.protocol !== "https:") {
      throw new ConnectorImportError("invalid_base_url", "baseUrl must use HTTPS.");
    }
    if (url.username || url.password) {
      throw new ConnectorImportError("invalid_base_url", "baseUrl cannot contain credentials.");
    }
    if (isPrivateHost(url.hostname)) {
      throw new ConnectorImportError("invalid_base_url", "baseUrl cannot point at a private or link-local host.");
    }
    return { baseUrl: `${url.origin}${url.pathname.replace(/\/$/, "")}`, hosts: [url.hostname] };
  }

  const servers = asArray(doc.servers).map(asObject).filter((server): server is Json => server !== null);
  if (!servers.length) {
    throw new ConnectorImportError(
      "servers_required",
      "The spec has no servers array. Add one, or pass baseUrl when importing.",
    );
  }
  const rawServer = text(servers[0].url);
  if (!rawServer) throw new ConnectorImportError("servers_required", "The first server has no url.");
  const variables = asObject(servers[0].variables) ?? {};
  const expanded = rawServer.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const variable = asObject(variables[name]);
    const fallback = variable ? text(variable.default) : "";
    return fallback || match;
  });
  if (/\{[^}]+\}/.test(expanded)) {
    throw new ConnectorImportError(
      "server_variable",
      "The first server URL uses a variable without a default. Pass an explicit baseUrl instead.",
    );
  }
  let url: URL;
  try {
    url = new URL(expanded);
  } catch {
    throw new ConnectorImportError(
      "invalid_server_url",
      "The first server URL is relative. Pass an explicit baseUrl when importing.",
    );
  }
  if (url.protocol !== "https:") {
    throw new ConnectorImportError("insecure_server", "Custom connectors must use HTTPS base URLs.");
  }
  if (isPrivateHost(url.hostname)) {
    throw new ConnectorImportError("insecure_server", "Custom connectors cannot target private or link-local hosts.");
  }
  const hosts = new Set<string>([url.hostname]);
  for (const server of servers.slice(1)) {
    try {
      const candidate = new URL(text(server.url));
      if (candidate.protocol !== "https:") continue;
      if (isPrivateHost(candidate.hostname)) {
        throw new ConnectorImportError(
          "insecure_server",
          `Server "${text(server.url)}" targets a private or link-local host.`,
        );
      }
      hosts.add(candidate.hostname);
    } catch (error) {
      if (error instanceof ConnectorImportError) throw error;
      // Ignore auxiliary servers that are not absolute URLs.
    }
  }
  return { baseUrl: `${url.origin}${url.pathname.replace(/\/$/, "")}`, hosts: [...hosts] };
}

function joinBase(baseUrl: string, path: string) {
  const basePath = new URL(baseUrl).pathname.replace(/\/$/, "");
  const joined = `${basePath}/${path.replace(/^\//, "")}`.replace(/\/+/g, "/");
  return joined === "/" ? joined : joined.startsWith("/") ? joined : `/${joined}`;
}

function normalizeBase(baseUrl: string) {
  return baseUrl.replace(/\/$/, "");
}

function securitySchemes(doc: Json) {
  const components = asObject(doc.components) ?? {};
  const schemes = asObject(components.securitySchemes) ?? {};
  const entries: { name: string; scheme: Json; type: string }[] = [];
  for (const [name, raw] of Object.entries(schemes)) {
    const scheme = asObject(deref(doc, raw));
    if (!scheme) continue;
    entries.push({ name, scheme, type: text(scheme.type) });
  }
  return entries;
}

function compileSecurity(doc: Json, schemeName?: string): { stored: StoredInjection; name: string } {
  const entries = securitySchemes(doc);
  let chosen: { name: string; scheme: Json; type: string } | undefined;
  if (schemeName) {
    chosen = entries.find((entry) => entry.name === schemeName);
    if (!chosen) {
      throw new ConnectorImportError("unknown_auth_scheme", `No security scheme named "${schemeName}" exists in the spec.`);
    }
  } else {
    chosen = entries.find((entry) => {
      if (entry.type === "http") {
        const scheme = text(entry.scheme.scheme).toLowerCase();
        return scheme === "bearer" || scheme === "basic";
      }
      return entry.type === "apiKey";
    });
  }

  if (!chosen) {
    const onlyOauth = entries.length > 0 && entries.every((entry) => entry.type === "oauth2" || entry.type === "openIdConnect");
    if (onlyOauth) {
      throw new ConnectorImportError(
        "oauth_not_supported",
        "OAuth2 and OpenID Connect security schemes need an OAuth app and provider-specific token flow. Use a bearer token scheme, or register the provider under OAuth apps.",
      );
    }
    throw new ConnectorImportError(
      "auth_required",
      "No supported security scheme was found. Add an apiKey, HTTP bearer or HTTP basic scheme.",
    );
  }

  const type = chosen.type;
  if (type === "apiKey") {
    const location = text(chosen.scheme.in);
    if (location !== "header" && location !== "query") {
      throw new ConnectorImportError("unsupported_auth", "apiKey schemes must inject into a header or query parameter.");
    }
    const name = text(chosen.scheme.name);
    if (!name) throw new ConnectorImportError("unsupported_auth", "The apiKey scheme has no name.");
    const field: CredentialField = {
      key: "api_key",
      label: `${name} value`,
      secret: true,
      required: true,
      placeholder: "Paste the key",
      help: `Injected as the ${name} ${location === "header" ? "header" : "query parameter"}.`,
    };
    return {
      name: chosen.name,
      stored: {
        injection: { type: location, name, field: "api_key" },
        authMethods: [{ type: "api_key", label: `API key (${name})` }],
        defaultAuth: "api_key",
        redactedFields: ["api_key"],
      },
    };
  }

  const scheme = text(chosen.scheme.scheme).toLowerCase();
  if (type === "http" && scheme === "basic") {
    return {
      name: chosen.name,
      stored: {
        injection: {
          type: "header",
          name: "Authorization",
          basic: { usernameField: "username", passwordField: "password" },
        },
        authMethods: [{ type: "basic", label: "Basic auth (username and password)" }],
        defaultAuth: "basic",
        redactedFields: ["username", "password"],
      },
    };
  }
  if (type === "http" && scheme === "bearer") {
    return {
      name: chosen.name,
      stored: {
        injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "token" },
        authMethods: [{ type: "bearer", label: `Bearer token (${chosen.name})` }],
        defaultAuth: "bearer",
        redactedFields: ["token"],
      },
    };
  }
  throw new ConnectorImportError(
    "unsupported_auth",
    `Security scheme "${chosen.name}" (${type}${scheme ? `/${scheme}` : ""}) cannot be injected by the proxy.`,
  );
}

function credentialFieldsFor(stored: StoredInjection): CredentialField[] {
  if (stored.defaultAuth === "basic") {
    return [
      { key: "username", label: "Username", required: true, placeholder: "Service username" },
      { key: "password", label: "Password", secret: true, required: true, placeholder: "Service password" },
    ];
  }
  if (stored.defaultAuth === "api_key") {
    return [
      {
        key: "api_key",
        label: "API key",
        secret: true,
        required: true,
        placeholder: "Paste the key",
        help: `Injected as ${stored.injection.type === "header" ? "a header" : "a query parameter"}: ${stored.injection.name}.`,
      },
    ];
  }
  return [
    {
      key: "token",
      label: "Bearer token",
      secret: true,
      required: true,
      placeholder: "eyJ…",
      help: "Injected as Authorization: Bearer <token>.",
    },
  ];
}

function operationSecurityAllows(doc: Json, operation: Json, schemeName: string) {
  const security = asArray(operation.security ?? doc.security);
  if (!security.length) return false;
  return security.some((requirement) => {
    const names = Object.keys(asObject(requirement) ?? {});
    return names.includes(schemeName);
  });
}

function riskFor(method: string, path: string, operation: Json): Risk {
  const explicit = text(operation["x-authab-risk"]).toLowerCase();
  if (RISK_VALUES.includes(explicit as Risk)) return explicit as Risk;
  const haystack = `${method} ${path} ${text(operation.operationId)} ${text(operation.summary)}`.toLowerCase();
  if (method === "get") {
    return SENSITIVE_READ_WORDS.test(haystack) ? "admin" : "read";
  }
  if (method === "delete") return "destructive";
  if (DESTRUCTIVE_WORDS.test(haystack)) return "destructive";
  if (FINANCIAL_WORDS.test(haystack)) return "financial";
  if (ADMIN_WORDS.test(haystack)) return "admin";
  return "write";
}

function actionName(slug: string, operationId: string, method: string, path: string, used: Set<string>) {
  const safeOperation = operationId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56);
  const derived = path
    .replace(/[{}]/g, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  let base = safeOperation
    ? safeOperation.startsWith(`${slug}.`)
      ? safeOperation
      : `${slug}.${safeOperation}`
    : `${slug}.${method}_${derived || "root"}`;
  base = base.slice(0, 72);
  let name = base;
  let counter = 2;
  while (used.has(name)) {
    name = `${base}_${counter}`;
    counter += 1;
  }
  used.add(name);
  return name;
}

function schemaFields(doc: Json, schemaInput: unknown): ConnectorAction["fields"] {
  const schema = asObject(deref(doc, schemaInput));
  if (!schema) return [];
  const properties = asObject(schema.properties);
  if (!properties) return [];
  const required = new Set(asArray(schema.required).map((value) => String(value)));
  return Object.entries(properties)
    .slice(0, 25)
    .map(([key, raw]) => {
      const property = asObject(deref(doc, raw)) ?? {};
      const example = property.example ?? property.default;
      return {
        key,
        label: text(property.title) || key,
        required: required.has(key),
        placeholder: typeof example === "string" || typeof example === "number" ? String(example).slice(0, 80) : undefined,
      };
    });
}

type Param = { name: string; in: string; required: boolean; description: string };

function parametersFor(doc: Json, pathItem: Json, operation: Json): Param[] {
  const merged = new Map<string, Param>();
  for (const raw of [...asArray(pathItem.parameters), ...asArray(operation.parameters)]) {
    const parameter = asObject(deref(doc, raw));
    if (!parameter) continue;
    const name = text(parameter.name);
    const location = text(parameter.in);
    if (!name || !location) continue;
    merged.set(`${location}:${name}`, {
      name,
      in: location,
      required: parameter.required === true,
      description: text(parameter.description),
    });
  }
  return [...merged.values()];
}

export function compileOpenApiSpec(
  specText: string,
  options: {
    slug: string;
    name?: string;
    category?: string;
    color?: string;
    mark?: string;
    baseUrl?: string;
    authScheme?: string;
  },
): { connector: Connector; specVersion: string; warnings: string[] } {
  const doc = parseOpenApiSpec(specText);
  const slug = slugify(options.slug);
  if (slug.length < 2) throw new ConnectorImportError("invalid_slug", "Use a slug with at least two letters.");
  if (CONNECTOR_MAP[slug]) {
    throw new ConnectorImportError("slug_taken", `"${slug}" is a built-in connector. Pick a different slug.`);
  }

  const info = asObject(doc.info) ?? {};
  const name = clip(options.name?.trim() || text(info.title).trim() || slug, 60);
  const { stored, name: schemeName } = compileSecurity(doc, options.authScheme);
  const { baseUrl, hosts } = serverInfo(doc, options.baseUrl);
  const credentialFields = credentialFieldsFor(stored);
  const paths = asObject(doc.paths) ?? {};
  const actions: ConnectorAction[] = [];
  const usedNames = new Set<string>();
  const warnings: string[] = [];

  for (const [rawPath, rawPathItem] of Object.entries(paths)) {
    if (!rawPath.startsWith("/")) {
      warnings.push(`Skipped "${rawPath}": paths must start with "/".`);
      continue;
    }
    if (rawPath.includes("..")) {
      warnings.push(`Skipped "${rawPath}": path traversal is not allowed.`);
      continue;
    }
    const pathItem = asObject(deref(doc, rawPathItem));
    if (!pathItem) continue;

    for (const method of METHODS) {
      const operation = asObject(pathItem[method]);
      if (!operation || operation.deprecated === true) continue;
      const label = `${method.toUpperCase()} ${rawPath}`;

      if (!operationSecurityAllows(doc, operation, schemeName)) {
        warnings.push(`Skipped ${label}: it does not accept the "${schemeName}" security scheme.`);
        continue;
      }
      const parameters = parametersFor(doc, pathItem, operation);
      if (parameters.some((parameter) => parameter.required && (parameter.in === "header" || parameter.in === "cookie"))) {
        warnings.push(`Skipped ${label}: required header or cookie parameters are not forwarded by the proxy.`);
        continue;
      }

      let bodyFormat: "json" | "form" = "json";
      let fields: NonNullable<ConnectorAction["fields"]> = [];
      const requestBody = asObject(deref(doc, operation.requestBody));
      const content = requestBody ? asObject(requestBody.content) ?? {} : {};
      if (Object.keys(content).length) {
        const supported = ["application/json", "application/x-www-form-urlencoded"];
        const contentType = supported.find((type) => content[type]);
        if (!contentType) {
          warnings.push(`Skipped ${label}: only JSON and form-encoded request bodies are supported.`);
          continue;
        }
        bodyFormat = contentType === "application/x-www-form-urlencoded" ? "form" : "json";
        const media = asObject(content[contentType]) ?? {};
        fields = schemaFields(doc, media.schema) ?? [];
      }

      const pathParams = parameters.filter((parameter) => parameter.in === "path");
      const queryParams = parameters.filter((parameter) => parameter.in === "query");
      const parameterFields = [...pathParams, ...queryParams].map((parameter) => ({
        key: parameter.name,
        label: parameter.description || parameter.name,
        required: parameter.required || parameter.in === "path",
        placeholder: parameter.name,
      }));
      const seenFields = new Set<string>();
      const actionFields = [...parameterFields, ...(fields ?? [])].filter((field) => {
        if (seenFields.has(field.key)) return false;
        seenFields.add(field.key);
        return true;
      });
      const risk = riskFor(method, rawPath, operation);
      const summary = text(operation.summary);
      const description = text(operation.description) || summary;
      actions.push({
        name: actionName(slug, text(operation.operationId), method, rawPath, usedNames),
        label: clip(summary || text(operation.operationId) || `${method.toUpperCase()} ${rawPath}`, 90),
        description: clip(description || `${method.toUpperCase()} ${rawPath}`, 320),
        method: method.toUpperCase() as ConnectorAction["method"],
        path: joinBase(baseUrl, rawPath),
        risk,
        host: new URL(baseUrl).hostname,
        bodyFormat,
        queryFields: queryParams.map((parameter) => parameter.name),
        fields: actionFields,
      });
      if (actions.length >= MAX_ACTIONS) {
        warnings.push(`Stopped after ${MAX_ACTIONS} actions. Split the spec if you need more.`);
        break;
      }
    }
    if (actions.length >= MAX_ACTIONS) break;
  }

  if (!actions.length) {
    const reason = warnings[0] ? ` ${warnings[0]}` : "";
    throw new ConnectorImportError(
      "no_actions",
      `No importable actions were found.${reason} Actions need a supported method, a security scheme the proxy can inject, and JSON or form bodies.`,
    );
  }

  const healthAction = actions.find(
    (action) =>
      action.method === "GET" &&
      !action.path.includes("{") &&
      !(action.queryFields ?? []).some((field) => action.fields?.find((entry) => entry.key === field)?.required),
  );

  const description = clip(
    text(info.description).trim() || `${name} imported from OpenAPI ${text(doc.openapi)} with ${actions.length} actions.`,
    600,
  );
  const mark = clip(options.mark?.trim() || name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "CU", 3);
  const colorSeed = parseInt(createHash("sha256").update(slug).digest("hex").slice(0, 2), 16);
  const color = /^#[0-9a-f]{6}$/i.test(options.color ?? "") ? options.color! : COLORS[colorSeed % COLORS.length];

  const connectorDef: Connector = {
    slug,
    name,
    category: clip(options.category?.trim() || "Custom", 40),
    description,
    color,
    mark,
    docsUrl: "",
    authMethods: stored.authMethods,
    defaultAuth: stored.defaultAuth,
    hosts,
    injection: stored.injection,
    healthCheck: healthAction ? { method: "GET", path: healthAction.path } : undefined,
    credentialFields,
    scopes: [],
    resourceLabel: "Resource",
    resourcePlaceholder: "record id",
    actions,
    status: "beta",
    version: "1",
    redactedFields: stored.redactedFields,
  };

  return { connector: connectorDef, specVersion: text(doc.openapi), warnings };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function customConnectorToConnector(row: CustomConnector): Connector {
  const stored = parseJson<StoredInjection>(row.injectionJson, {
    injection: { type: "header", name: "Authorization", prefix: "Bearer ", field: "token" },
    authMethods: [{ type: "bearer", label: "Bearer token" }],
    defaultAuth: "bearer",
    redactedFields: ["token"],
  });
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    description: row.description,
    color: row.color,
    mark: row.mark,
    docsUrl: "",
    authMethods: stored.authMethods,
    defaultAuth: stored.defaultAuth,
    hosts: parseJson<string[]>(row.hostsJson, []),
    injection: stored.injection,
    healthCheck: row.healthCheckJson
      ? parseJson<Connector["healthCheck"]>(row.healthCheckJson, undefined)
      : undefined,
    credentialFields: parseJson<CredentialField[]>(row.credentialFieldsJson, []),
    scopes: [],
    resourceLabel: "Resource",
    resourcePlaceholder: "record id",
    actions: parseJson<ConnectorAction[]>(row.actionsJson, []),
    status: "beta",
    version: String(row.version),
    redactedFields: stored.redactedFields,
    source: "custom",
  };
}

type CacheEntry = { expires: number; connector: Connector | null };

const connectorCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

export function invalidateConnectorCache(environmentId: string, slug?: string) {
  if (slug) {
    connectorCache.delete(`${environmentId}:${slug}`);
    return;
  }
  for (const key of connectorCache.keys()) {
    if (key.startsWith(`${environmentId}:`)) connectorCache.delete(key);
  }
}

export async function resolveConnector(slug: string, environmentId: string): Promise<Connector | null> {
  if (slug === SANDBOX_CONNECTOR.slug) return SANDBOX_CONNECTOR;
  const builtin = builtinConnector(slug);
  if (builtin) return builtin;
  const key = `${environmentId}:${slug}`;
  const cached = connectorCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.connector;
  const row = await db.customConnector.findUnique({
    where: { environmentId_slug: { environmentId, slug } },
    include: {
      environment: {
        select: { project: { select: { org: { select: { plan: true, planStatus: true } } } } },
      },
    },
  });
  const org = row?.environment.project.org;
  const access = org ? customConnectorAccess(org.plan, org.planStatus) : null;
  const def =
    row && row.status === "active" && !row.archivedAt && access?.allowed
      ? customConnectorToConnector(row)
      : null;
  connectorCache.set(key, { connector: def, expires: Date.now() + CACHE_TTL_MS });
  return def;
}

export async function loadConnectorMap(environmentId: string): Promise<Map<string, Connector>> {
  const map = new Map<string, Connector>(Object.entries(CONNECTOR_MAP));
  map.set(SANDBOX_CONNECTOR.slug, SANDBOX_CONNECTOR);
  const environment = await db.environment.findUnique({
    where: { id: environmentId },
    select: { project: { select: { org: { select: { plan: true, planStatus: true } } } } },
  });
  if (!environment) return map;
  const access = customConnectorAccess(
    environment.project.org.plan,
    environment.project.org.planStatus,
  );
  if (!access.allowed) return map;
  const rows = await db.customConnector.findMany({
    where: { environmentId, status: "active", archivedAt: null },
    orderBy: { name: "asc" },
  });
  for (const row of rows) map.set(row.slug, customConnectorToConnector(row));
  return map;
}

function versionData(connector: Connector, specVersion: string, specHash: string, createdBy: string | null) {
  return {
    name: connector.name,
    description: connector.description,
    hostsJson: JSON.stringify(connector.hosts),
    baseUrl: connector.hosts[0] ? `https://${connector.hosts[0]}` : "",
    injectionJson: JSON.stringify({
      injection: connector.injection,
      authMethods: connector.authMethods,
      defaultAuth: connector.defaultAuth,
      redactedFields: connector.redactedFields,
    } satisfies StoredInjection),
    credentialFieldsJson: JSON.stringify(connector.credentialFields ?? []),
    actionsJson: JSON.stringify(connector.actions),
    healthCheckJson: connector.healthCheck ? JSON.stringify(connector.healthCheck) : null,
    specVersion,
    specHash,
    createdBy,
  };
}

export async function importOpenApiConnector(opts: {
  environmentId: string;
  specText: string;
  slug?: string;
  name?: string;
  category?: string;
  color?: string;
  mark?: string;
  baseUrl?: string;
  authScheme?: string;
  createdBy?: string | null;
}): Promise<ImportResult> {
  const draftSlug = slugify(opts.slug?.trim() || "");
  const probe = parseOpenApiSpec(opts.specText);
  const info = asObject(probe.info) ?? {};
  const slug = draftSlug.length >= 2 ? draftSlug : slugify(text(info.title));
  if (!slug) {
    throw new ConnectorImportError("invalid_slug", "Give the connector a slug (lowercase letters and dashes).");
  }
  const compiled = compileOpenApiSpec(opts.specText, {
    slug,
    name: opts.name,
    category: opts.category,
    color: opts.color,
    mark: opts.mark,
    baseUrl: opts.baseUrl,
    authScheme: opts.authScheme,
  });
  for (const host of compiled.connector.hosts) {
    try {
      await assertSafeOutboundUrl(`https://${host}`, "Connector server");
    } catch (error) {
      throw new ConnectorImportError("invalid_server_url", (error as Error).message);
    }
  }
  const specHash = createHash("sha256")
    .update(
      JSON.stringify({ baseUrl: opts.baseUrl ?? null, authScheme: opts.authScheme ?? null, category: opts.category ?? null }),
    )
    .update("\n")
    .update(opts.specText)
    .digest("hex");

  const existing = await db.customConnector.findUnique({
    where: { environmentId_slug: { environmentId: opts.environmentId, slug } },
  });
  if (existing && existing.status === "active" && existing.specHash === specHash) {
    return {
      connector: existing,
      compiled: customConnectorToConnector(existing),
      version: existing.version,
      unchanged: true,
      warnings: compiled.warnings,
    };
  }

  const nextVersion = existing ? existing.version + 1 : 1;
  const data = versionData(compiled.connector, compiled.specVersion, specHash, opts.createdBy ?? null);
  const connectorRow = await db.$transaction(async (tx) => {
    const row = existing
      ? await tx.customConnector.update({
          where: { id: existing.id },
          data: {
            ...data,
            category: compiled.connector.category,
            color: compiled.connector.color,
            mark: compiled.connector.mark,
            version: nextVersion,
            status: "active",
            archivedAt: null,
          },
        })
      : await tx.customConnector.create({
          data: {
            environmentId: opts.environmentId,
            slug,
            ...data,
            category: compiled.connector.category,
            color: compiled.connector.color,
            mark: compiled.connector.mark,
            version: nextVersion,
            status: "active",
            createdBy: opts.createdBy ?? null,
          },
        });
    await tx.customConnectorVersion.create({
      data: { customConnectorId: row.id, version: nextVersion, ...data },
    });
    return row;
  });

  invalidateConnectorCache(opts.environmentId, slug);
  await auditEvent({
    environmentId: opts.environmentId,
    actorType: "human",
    actorId: opts.createdBy ?? null,
    actorName: "Connector import",
    action: existing ? "connector.versioned" : "connector.imported",
    resourceType: "custom_connector",
    resourceId: connectorRow.id,
    outcome: "recorded",
    payloadSummary: {
      slug,
      name: compiled.connector.name,
      version: nextVersion,
      specVersion: compiled.specVersion,
      actions: compiled.connector.actions.length,
      hosts: compiled.connector.hosts,
      auth: compiled.connector.defaultAuth,
      warnings: compiled.warnings.length,
    },
  });

  return {
    connector: connectorRow,
    compiled: customConnectorToConnector(connectorRow),
    version: nextVersion,
    unchanged: false,
    warnings: compiled.warnings,
  };
}

export async function listCustomConnectors(environmentId: string) {
  return db.customConnector.findMany({
    where: { environmentId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

export async function rollbackCustomConnector(opts: {
  environmentId: string;
  slug: string;
  version: number;
  createdBy?: string | null;
}) {
  const connectorRow = await db.customConnector.findUnique({
    where: { environmentId_slug: { environmentId: opts.environmentId, slug: opts.slug } },
  });
  if (!connectorRow) return null;
  const target = await db.customConnectorVersion.findUnique({
    where: { customConnectorId_version: { customConnectorId: connectorRow.id, version: opts.version } },
  });
  if (!target) throw new ConnectorImportError("version_not_found", `Version ${opts.version} does not exist for this connector.`);
  if (target.version === connectorRow.version) return { connector: connectorRow, version: connectorRow.version, unchanged: true };

  const nextVersion = connectorRow.version + 1;
  const data = {
    name: target.name,
    description: target.description,
    hostsJson: target.hostsJson,
    baseUrl: target.baseUrl,
    injectionJson: target.injectionJson,
    credentialFieldsJson: target.credentialFieldsJson,
    actionsJson: target.actionsJson,
    healthCheckJson: target.healthCheckJson,
    specVersion: target.specVersion,
    specHash: target.specHash,
    createdBy: opts.createdBy ?? target.createdBy ?? null,
  };
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.customConnector.update({
      where: { id: connectorRow.id },
      data: { ...data, version: nextVersion, status: "active", archivedAt: null },
    });
    await tx.customConnectorVersion.create({
      data: { customConnectorId: connectorRow.id, version: nextVersion, ...data },
    });
    return row;
  });
  invalidateConnectorCache(opts.environmentId, opts.slug);
  await auditEvent({
    environmentId: opts.environmentId,
    actorType: "human",
    actorId: opts.createdBy ?? null,
    actorName: "Connector rollback",
    action: "connector.rolled_back",
    resourceType: "custom_connector",
    resourceId: connectorRow.id,
    outcome: "recorded",
    payloadSummary: { slug: opts.slug, restoredFrom: opts.version, newVersion: nextVersion },
  });
  return { connector: updated, version: nextVersion, unchanged: false };
}

export async function archiveCustomConnector(opts: {
  environmentId: string;
  slug: string;
  createdBy?: string | null;
}) {
  const connectorRow = await db.customConnector.findUnique({
    where: { environmentId_slug: { environmentId: opts.environmentId, slug: opts.slug } },
  });
  if (!connectorRow) return null;
  if (connectorRow.status === "archived") return connectorRow;
  const updated = await db.customConnector.update({
    where: { id: connectorRow.id },
    data: { status: "archived", archivedAt: new Date() },
  });
  invalidateConnectorCache(opts.environmentId, opts.slug);
  await auditEvent({
    environmentId: opts.environmentId,
    actorType: "human",
    actorId: opts.createdBy ?? null,
    actorName: "Connector archive",
    action: "connector.archived",
    resourceType: "custom_connector",
    resourceId: connectorRow.id,
    outcome: "recorded",
    payloadSummary: { slug: opts.slug, version: connectorRow.version },
  });
  return updated;
}

export function customConnectorAccess(planKey: string, planStatus?: string | null) {
  if (!isBillingActive(planStatus)) {
    return {
      allowed: false,
      message: `Custom connectors are suspended while billing is ${planStatus ?? "inactive"}. Update billing to restore access.`,
    };
  }
  const plan = planFor(planKey);
  const allowed = plan.key === "scale" || plan.key === "enterprise";
  return {
    allowed,
    message: allowed
      ? ""
      : "Custom OpenAPI connectors are available on Scale and Enterprise. Upgrade the workspace to import the long tail.",
  };
}

export async function customConnectorAccessFor(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true, planStatus: true } });
  return customConnectorAccess(org?.plan ?? "free", org?.planStatus);
}

export function serializeCustomConnector(row: CustomConnector) {
  const def = customConnectorToConnector(row);
  return {
    id: row.id,
    object: "custom_connector",
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    version: row.version,
    specVersion: row.specVersion,
    status: row.status,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    hosts: def.hosts,
    auth: { type: def.defaultAuth, methods: def.authMethods },
    credentialFields: (def.credentialFields ?? []).map((field) => ({
      key: field.key,
      label: field.label,
      secret: field.secret === true,
      required: field.required === true,
    })),
    actions: def.actions.map((action) => ({
      name: action.name,
      label: action.label,
      description: action.description,
      method: action.method,
      path: action.path,
      risk: action.risk,
      resourceLabel: action.resourceLabel ?? null,
      queryFields: action.queryFields ?? [],
      fields: action.fields ?? [],
    })),
    healthCheck: def.healthCheck ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
