import type { ConnectorAction, Risk } from "../../connectors";

type Method = ConnectorAction["method"];

export function actionFactory(slug: string) {
  return (
    suffix: string,
    label: string,
    method: Method,
    path: string,
    risk: Risk,
    description: string,
    extra: Partial<ConnectorAction> = {},
  ): ConnectorAction => ({
    name: `${slug}.${suffix}`,
    label,
    method,
    path,
    risk,
    description,
    ...extra,
  });
}

export const docsBase = "https://authab.dev/docs/connectors";
