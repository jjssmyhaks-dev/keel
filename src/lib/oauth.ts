export type Provider = "google" | "github";

type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
};

export function providerConfig(provider: string): ProviderConfig | null {
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
    };
  }
  if (provider === "github") {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scope: "read:user user:email",
    };
  }
  return null;
}

export function configuredProviders(): Provider[] {
  return (["google", "github"] as const).filter((provider) => providerConfig(provider) !== null);
}

export const OAuthCookie = {
  state: (provider: string) => `keel_oauth_state_${provider}`,
  next: (provider: string) => `keel_oauth_next_${provider}`,
};

export type OAuthProfile = {
  email: string;
  name: string;
  avatarUrl?: string | null;
  providerId: string;
};

export async function exchangeCode(provider: Provider, code: string): Promise<OAuthProfile> {
  const config = providerConfig(provider);
  if (!config) throw new Error("OAuth provider is not configured.");

  const redirectUri = `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/auth/oauth/${provider}/callback`;
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) throw new Error("Could not exchange the authorization code.");
  const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string };
  const accessToken = tokenBody.access_token;
  if (!accessToken) throw new Error(tokenBody.error || "Provider returned no access token.");

  if (provider === "google") {
    const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!info.ok) throw new Error("Could not read the Google profile.");
    const p = (await info.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!p.email) throw new Error("Google did not return an email address.");
    if (p.email_verified === false) throw new Error("Google has not verified this email address.");
    return { email: p.email.toLowerCase(), name: p.name || p.email.split("@")[0], avatarUrl: p.picture, providerId: p.sub };
  }

  const info = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
  });
  if (!info.ok) throw new Error("Could not read the GitHub profile.");
  const p = (await info.json()) as { id: number; login: string; name?: string; avatar_url?: string };

  const emails = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
  });
  if (!emails.ok) throw new Error("Could not read the verified emails on this GitHub account.");
  const list = (await emails.json()) as { email: string; primary: boolean; verified: boolean }[];
  const chosen = list.find((entry) => entry.primary && entry.verified) ?? list.find((entry) => entry.verified);
  if (!chosen) {
    throw new Error("GitHub did not return a verified email address. Verify one in your GitHub settings and retry.");
  }

  return {
    email: chosen.email.toLowerCase(),
    name: p.name || p.login,
    avatarUrl: p.avatar_url,
    providerId: String(p.id),
  };
}
