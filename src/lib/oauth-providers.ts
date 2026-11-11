export type OAuthProviderDef = {
  key: string;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator: string;
  tokenAuth: "basic" | "body";
  pkce: boolean;
  extraAuthParams?: Record<string, string>;
};

/**
 * Provider endpoints for one-click connections. These are the real vendor
 * authorization and token endpoints. Client credentials come from
 * CONNECT_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET or from an OAuth app stored in
 * the environment.
 */
export const CONNECT_PROVIDERS: Record<string, OAuthProviderDef> = {
  google: {
    key: "google",
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    scopeSeparator: " ",
    tokenAuth: "body",
    pkce: true,
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
  },
  github: {
    key: "github",
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "workflow", "read:user", "user:email"],
    scopeSeparator: " ",
    tokenAuth: "body",
    pkce: false,
  },
  slack: {
    key: "slack",
    label: "Slack",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["channels:read", "chat:write", "files:write", "users:read"],
    scopeSeparator: ",",
    tokenAuth: "body",
    pkce: false,
  },
  notion: {
    key: "notion",
    label: "Notion",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    scopeSeparator: " ",
    tokenAuth: "basic",
    pkce: false,
    extraAuthParams: { owner: "user" },
  },
  hubspot: {
    key: "hubspot",
    label: "HubSpot",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.companies.read",
      "crm.objects.deals.read",
    ],
    scopeSeparator: " ",
    tokenAuth: "body",
    pkce: false,
  },
  linear: {
    key: "linear",
    label: "Linear",
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: ["read", "write"],
    scopeSeparator: ",",
    tokenAuth: "body",
    pkce: true,
  },
  atlassian: {
    key: "atlassian",
    label: "Atlassian",
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: [
      "read:jira-work",
      "write:jira-work",
      "read:jira-user",
      "read:confluence-content.all",
      "write:confluence-content",
      "offline_access",
    ],
    scopeSeparator: " ",
    tokenAuth: "body",
    pkce: false,
    extraAuthParams: { audience: "api.atlassian.com", prompt: "consent" },
  },
  "microsoft-365": {
    key: "microsoft-365",
    label: "Microsoft",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "offline_access",
      "User.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "Calendars.ReadWrite",
      "Files.ReadWrite.All",
      "Chat.ReadWrite",
      "ChannelMessage.Send",
      "Team.ReadBasic.All",
    ],
    scopeSeparator: " ",
    tokenAuth: "body",
    pkce: true,
  },
  salesforce: {
    key: "salesforce",
    label: "Salesforce",
    authorizeUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    scopes: ["api", "refresh_token"],
    scopeSeparator: " ",
    tokenAuth: "body",
    pkce: true,
  },
  airtable: {
    key: "airtable",
    label: "Airtable",
    authorizeUrl: "https://airtable.com/oauth2/v1/authorize",
    tokenUrl: "https://airtable.com/oauth2/v1/token",
    scopes: ["data.records:read", "data.records:write", "schema.bases:read"],
    scopeSeparator: " ",
    tokenAuth: "body",
    pkce: true,
  },
  figma: {
    key: "figma",
    label: "Figma",
    authorizeUrl: "https://www.figma.com/oauth",
    tokenUrl: "https://www.figma.com/api/oauth/token",
    scopes: ["file_read", "file_write"],
    scopeSeparator: " ",
    tokenAuth: "body",
    pkce: false,
  },
  dropbox: {
    key: "dropbox",
    label: "Dropbox",
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scopes: ["account_info.read", "files.content.read", "files.content.write", "sharing.read", "sharing.write"],
    scopeSeparator: " ",
    tokenAuth: "basic",
    pkce: true,
    extraAuthParams: { token_access_type: "offline" },
  },
};

export function builtinProvider(connectorSlug: string): OAuthProviderDef | null {
  return CONNECT_PROVIDERS[connectorSlug] ?? null;
}

export function providerEnvPrefix(connectorSlug: string) {
  return connectorSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

export function envClientFor(connectorSlug: string) {
  const prefix = `CONNECT_${providerEnvPrefix(connectorSlug)}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  const override = process.env[`${prefix}_SCOPES`];
  return {
    clientId,
    clientSecret,
    scopes: override
      ? override.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean)
      : undefined,
  };
}

export function providerSupportsConnect(connectorSlug: string) {
  return Boolean(builtinProvider(connectorSlug));
}
