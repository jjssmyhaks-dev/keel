#!/usr/bin/env node
// Proves the full provider path with a real credential: policy -> proxy -> provider -> audit.
// Read-only by default. The credential must already exist in the vault and be granted to the agent.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function fail(message) {
  console.error(message);
  process.exit(1);
}

let Authab;
let AuthabError;
try {
  ({ Authab, AuthabError } = require("../sdk/dist/index.js"));
} catch {
  fail("Build the SDK first: npm run sdk:build");
}

const baseUrl = process.env.AUTHAB_BASE_URL ?? "http://localhost:3000/api/v1";
const apiKey = process.env.AUTHAB_API_KEY;
const agentId = process.env.AUTHAB_AGENT_ID;
const connectorSlug = process.env.AUTHAB_CONNECTOR;

if (!apiKey) fail("Set AUTHAB_API_KEY to a secret key for the credential's environment.");
if (!agentId) fail("Set AUTHAB_AGENT_ID to the agent holding the grant.");
if (!connectorSlug) fail("Set AUTHAB_CONNECTOR to a connector slug, for example slack.");

let input = {};
if (process.env.AUTHAB_INPUT) {
  try {
    input = JSON.parse(process.env.AUTHAB_INPUT);
  } catch {
    fail("AUTHAB_INPUT must be a JSON object.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("AUTHAB_INPUT must be a JSON object.");
}

const authab = new Authab({ apiKey, baseUrl });

async function main() {
  const catalogue = await authab.connectors.list();
  const connector = catalogue.data.find((entry) => entry.slug === connectorSlug);
  if (!connector) fail(`Unknown connector "${connectorSlug}".`);

  const requested = process.env.AUTHAB_ACTION;
  const action = requested
    ? connector.actions.find((entry) => entry.name === requested)
    : connector.actions.find(
        (entry) =>
          entry.risk === "read" &&
          !entry.resourceLabel &&
          (entry.fields ?? []).every((field) => !field.required),
      );
  if (!action) {
    fail(
      requested
        ? `Connector "${connectorSlug}" has no action "${requested}".`
        : `No no-argument read action found for "${connectorSlug}". Set AUTHAB_ACTION and AUTHAB_INPUT.`,
    );
  }

  const resource = process.env.AUTHAB_RESOURCE;
  const credentialId = process.env.AUTHAB_CREDENTIAL_ID;

  let result;
  try {
    result = await authab.proxy.call({
      connector: connectorSlug,
      action: action.name,
      ...(credentialId ? { credentialId } : {}),
      ...(resource ? { resource } : {}),
      input,
      agentId,
    });
  } catch (error) {
    if (error instanceof AuthabError) {
      console.error(`FAILED ${error.status} ${error.code}: ${error.message}`);
      if (error.requestId) console.error(`requestId: ${error.requestId}`);
      if (error.details?.decision) console.error(`decision: ${JSON.stringify(error.details.decision)}`);
      process.exit(1);
    }
    throw error;
  }

  if (result.status === "pending_approval") {
    console.error("PENDING approval — a human must approve this call before the provider runs.");
    if (result.approvalUrl) console.error(`approvalUrl: ${result.approvalUrl}`);
    process.exit(2);
  }

  const providerStatus = result.result?.status;
  if (result.status !== "executed" || typeof providerStatus !== "number" || providerStatus >= 400) {
    console.error(`FAILED provider response: ${JSON.stringify({ status: result.status, result: result.result })}`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        connector: connectorSlug,
        action: action.name,
        credentialId: credentialId ?? "(oldest granted)",
        status: result.status,
        providerStatus,
        latencyMs: result.result.latencyMs,
        requestId: result.requestId,
        ...(process.env.AUTHAB_PRINT_BODY === "1" ? { body: result.result.body } : {}),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  if (error instanceof AuthabError) {
    console.error(`FAILED ${error.status} ${error.code}: ${error.message}`);
    if (error.requestId) console.error(`requestId: ${error.requestId}`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
