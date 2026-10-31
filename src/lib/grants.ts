import { connector } from "./connectors";

export function validateActions(connectorSlug: string, actions: string[]) {
  const connectorDef = connector(connectorSlug);
  if (!connectorDef) return { ok: false as const, error: "Unknown connector." };
  if (!Array.isArray(actions) || !actions.length) {
    return { ok: false as const, error: "Provide at least one action for the grant." };
  }
  const known = new Set(connectorDef.actions.map((a) => a.name));
  const valid = actions.every(
    (action) =>
      action === "*" ||
      known.has(action) ||
      action.startsWith("risk:") ||
      ["read", "write", "destructive", "financial"].includes(action),
  );
  return valid
    ? { ok: true as const, actions }
    : {
        ok: false as const,
        error: `Unknown action for ${connectorDef.name}. Use actions from the connector catalogue.`,
      };
}
