import { CONNECTORS, RISK_META, type Connector } from "../src/lib/connectors";

const errors: string[] = [];
const warnings: string[] = [];

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const RISKS = new Set(Object.keys(RISK_META));
const AUTH = new Set(["oauth", "api_key", "bearer", "basic"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fail = (message: string) => errors.push(message);

function fieldKeys(connector: Connector) {
  const keys = new Set((connector.credentialFields ?? []).map((field) => field.key));
  if (!connector.credentialFields?.length) keys.add("secret");
  return keys;
}

function checkFieldRefs(connector: Connector, label: string, ref: string | undefined, keys: Set<string>) {
  if (!ref) return;
  if (!keys.has(ref)) fail(`${connector.slug}: ${label} references unknown credential field "${ref}"`);
}

const seenSlugs = new Set<string>();

for (const connector of CONNECTORS) {
  const where = connector.slug || "(missing slug)";

  if (!SLUG.test(connector.slug)) fail(`${where}: slug is not kebab-case`);
  if (seenSlugs.has(connector.slug)) fail(`${where}: duplicate slug`);
  seenSlugs.add(connector.slug);

  if (!connector.name) fail(`${where}: missing name`);
  if (!connector.category) fail(`${where}: missing category`);
  if (!connector.description) fail(`${where}: missing description`);
  if (!connector.docsUrl) fail(`${where}: missing docsUrl`);
  if (!AUTH.has(connector.defaultAuth)) fail(`${where}: invalid defaultAuth "${connector.defaultAuth}"`);
  if (!connector.authMethods.length) fail(`${where}: no auth methods`);
  if (!connector.authMethods.some((method) => method.type === connector.defaultAuth)) {
    fail(`${where}: defaultAuth "${connector.defaultAuth}" is not listed in authMethods`);
  }
  if (!connector.hosts.length) fail(`${where}: no hosts`);
  for (const host of connector.hosts) {
    if (host.includes("://") || host.includes("/")) fail(`${where}: host "${host}" must be a bare hostname`);
  }
  if (!connector.injection?.name) fail(`${where}: missing injection header name`);
  if (!connector.actions.length) fail(`${where}: no actions`);

  const keys = fieldKeys(connector);
  const fields = connector.credentialFields ?? [];
  const fieldNames = new Set<string>();
  for (const field of fields) {
    if (fieldNames.has(field.key)) fail(`${where}: duplicate credential field "${field.key}"`);
    fieldNames.add(field.key);
    if (!field.label) fail(`${where}: credential field "${field.key}" missing label`);
  }
  for (const key of connector.requireAnyFields ?? []) {
    if (!keys.has(key)) fail(`${where}: requireAnyFields references unknown field "${key}"`);
  }
  checkFieldRefs(connector, "injection.field", connector.injection.field, keys);
  checkFieldRefs(connector, "baseUrlField", connector.baseUrlField, keys);
  if (connector.hostTemplate) {
    for (const [, name] of connector.hostTemplate.matchAll(/\{(\w+)\}/g)) {
      checkFieldRefs(connector, "hostTemplate", name, keys);
    }
  }

  const seenActions = new Set<string>();
  for (const action of connector.actions) {
    const at = `${where}.${action.name}`;
    if (!action.name.includes(".")) fail(`${at}: action name must be namespaced (e.g. "${connector.slug}.send")`);
    if (seenActions.has(action.name)) fail(`${at}: duplicate action name`);
    seenActions.add(action.name);
    if (!METHODS.has(action.method)) fail(`${at}: invalid method "${action.method}"`);
    if (!RISKS.has(action.risk)) fail(`${at}: invalid risk "${action.risk}"`);
    if (!action.path && !action.baseUrlField && !action.host) {
      fail(`${at}: missing path (or a baseUrlField that is the full endpoint)`);
    }
    if (!action.label) fail(`${at}: missing label`);
    if (action.sample === undefined) fail(`${at}: missing sample response`);

    checkFieldRefs(connector, `${action.name}.baseUrlField`, action.baseUrlField, keys);
    checkFieldRefs(connector, `${action.name}.authField`, action.authField, keys);
    if (action.argHeader) {
      if (!action.argHeader.name) fail(`${at}: argHeader is missing a header name`);
      if (action.argHeader.bodyField && !action.fields?.some((field) => field.key === action.argHeader?.bodyField)) {
        fail(`${at}: argHeader.bodyField references unknown input field "${action.argHeader.bodyField}"`);
      }
    }
    for (const header of action.extraHeaders ?? []) {
      checkFieldRefs(connector, `${action.name}.extraHeaders`, header.field, keys);
    }
    for (const param of action.queryParams ?? []) {
      checkFieldRefs(connector, `${action.name}.queryParams`, param.field, keys);
    }
  }
}

const riskCounts = new Map<string, number>();
for (const connector of CONNECTORS) {
  for (const action of connector.actions) {
    riskCounts.set(action.risk, (riskCounts.get(action.risk) ?? 0) + 1);
  }
}

const categories = new Map<string, number>();
for (const connector of CONNECTORS) {
  categories.set(connector.category, (categories.get(connector.category) ?? 0) + 1);
}

console.log(`Connectors: ${CONNECTORS.length}`);
console.log(`Actions: ${CONNECTORS.reduce((sum, connector) => sum + connector.actions.length, 0)}`);
console.log(`Categories: ${[...categories].map(([name, count]) => `${name} (${count})`).join(", ")}`);
console.log(`Risks: ${[...riskCounts].map(([name, count]) => `${name} (${count})`).join(", ")}`);

if (warnings.length) {
  console.log(`\nWarnings (${warnings.length}):`);
  for (const warning of warnings) console.log(`  · ${warning}`);
}

if (errors.length) {
  console.error(`\nErrors (${errors.length}):`);
  for (const error of errors) console.error(`  ✗ ${error}`);
  process.exit(1);
}

console.log("\nConnector contract OK");
