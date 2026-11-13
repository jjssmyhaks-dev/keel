import { db } from "./db";
import { encryptSecret } from "./crypto";
import { resolveConnector } from "./custom-connectors";

export type StoreCredentialInput = {
  projectId: string;
  environmentId: string;
  connectorSlug: string;
  name?: string;
  type?: string;
  fields: Record<string, string>;
  createdBy: string;
  expiresAt?: Date | null;
};

export type StoreCredentialErrorCode =
  | "unknown_connector"
  | "type_not_supported"
  | "secret_required"
  | "field_required";

export type StoreCredentialResult =
  | {
      ok: true;
      credential: {
        id: string;
        connectorSlug: string;
        name: string;
        type: string;
        maskedHint: string;
        metadata: Record<string, unknown>;
      };
    }
  | { ok: false; code: StoreCredentialErrorCode; message: string; fields?: string[] };

function primaryKey(type: string) {
  return type === "api_key" ? "apiKey" : type === "oauth" ? "accessToken" : "token";
}

/** Shared by the vault form and the env importer so both seal credentials the same way. */
export async function storeCredential(input: StoreCredentialInput): Promise<StoreCredentialResult> {
  const connector = await resolveConnector(input.connectorSlug, input.environmentId);
  if (!connector) {
    return { ok: false, code: "unknown_connector", message: "Pick a connector we support." };
  }

  const allowedTypes = connector.authMethods.map((method) => method.type as string);
  if (input.type && !allowedTypes.includes(input.type)) {
    return {
      ok: false,
      code: "type_not_supported",
      message: `${connector.name} does not support ${input.type} authentication.`,
    };
  }
  const type = input.type ?? connector.defaultAuth;

  const provided: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input.fields)) {
    const value = String(raw ?? "").trim();
    if (value) provided[key] = value;
  }

  const payload: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  let maskedHint = "";

  if (connector.credentialFields?.length) {
    for (const field of connector.credentialFields) {
      const value = provided[field.key];
      if (!value) continue;
      payload[field.key] = value;
      if (field.secret) {
        if (!maskedHint) maskedHint = `••••${value.slice(-4)}`;
      } else {
        metadata[field.key] = value;
      }
    }
    const missing = connector.credentialFields.filter((field) => field.required && !payload[field.key]).map((field) => field.key);
    if (missing.length) {
      return {
        ok: false,
        code: "field_required",
        message: `Missing required fields for ${connector.name}: ${missing.join(", ")}.`,
        fields: missing,
      };
    }
    if (connector.requireAnyFields?.length && !connector.requireAnyFields.some((key) => payload[key])) {
      return {
        ok: false,
        code: "field_required",
        message: `Provide at least one of: ${connector.requireAnyFields.join(", ")}.`,
        fields: connector.requireAnyFields,
      };
    }
    if (!maskedHint && connector.credentialFields.some((field) => field.secret)) {
      return { ok: false, code: "secret_required", message: "Provide at least one secret field." };
    }
  } else {
    const key = primaryKey(type);
    const secret = provided.secret || provided[key] || Object.values(provided)[0];
    if (!secret) {
      return { ok: false, code: "secret_required", message: "Paste a credential before saving." };
    }
    payload[key] = secret;
    maskedHint = `••••${secret.slice(-4)}`;
  }

  const sealed = await encryptSecret(input.projectId, payload);
  const credential = await db.credential.create({
    data: {
      environmentId: input.environmentId,
      connectorSlug: connector.slug,
      name: (input.name?.trim() || connector.name).slice(0, 80),
      type,
      encryptedPayload: sealed.encryptedPayload,
      dataKeyEncrypted: sealed.dataKeyEncrypted,
      metadataJson: JSON.stringify(metadata),
      maskedHint,
      status: "unverified",
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
      healthEvents: { create: { result: "stored", detail: "Stored and encrypted. Not yet verified by a provider call." } },
    },
  });

  return {
    ok: true,
    credential: {
      id: credential.id,
      connectorSlug: connector.slug,
      name: credential.name,
      type,
      maskedHint,
      metadata,
    },
  };
}
