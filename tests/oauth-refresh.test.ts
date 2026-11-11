import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import test from "node:test";
import {
  OAuthTokenError,
  buildAuthorizeUrl,
  codeChallenge,
  exchangeAuthorizationCode,
  normalizeTokens,
  refreshAccessToken,
  type ResolvedOAuthClient,
} from "../src/lib/oauth-connect";
import { isPrivateAddress, isPrivateHost, privateHostname } from "../src/lib/outbound";

const mutableEnv = process.env as Record<string, string | undefined>;
mutableEnv.AUTHAB_ALLOW_PRIVATE_PROVIDER_HOSTS = "1";
mutableEnv.NODE_ENV = "test";

type CapturedRequest = { method: string; headers: IncomingHttpHeaders; body: string };

function clientFor(tokenUrl: string, overrides: Partial<ResolvedOAuthClient> = {}): ResolvedOAuthClient {
  return {
    connectorSlug: "acme",
    label: "Acme",
    authorizeUrl: "https://acme.example/authorize",
    tokenUrl,
    clientId: "client-1",
    clientSecret: "secret-1",
    scopes: ["read", "write"],
    scopeSeparator: " ",
    tokenAuth: "basic",
    pkce: true,
    extraAuthParams: {},
    source: "env",
    ...overrides,
  };
}

function json(res: ServerResponse, status: number, payload: Record<string, unknown>) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function withTokenServer(
  handler: (request: CapturedRequest, res: ServerResponse) => void,
  run: (tokenUrl: string, requests: CapturedRequest[]) => Promise<void>,
) {
  const requests: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      const captured = { method: req.method ?? "", headers: req.headers, body };
      requests.push(captured);
      handler(captured, res);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}/oauth/token`, requests);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("refreshes a token with HTTP basic client authentication", async () => {
  await withTokenServer(
    (_request, res) =>
      json(res, 200, {
        access_token: "new-access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rotated-refresh",
        scope: "read write",
      }),
    async (tokenUrl, requests) => {
      const tokens = await refreshAccessToken(clientFor(tokenUrl), "refresh-1");
      assert.equal(tokens.accessToken, "new-access");
      assert.equal(tokens.refreshToken, "rotated-refresh");
      assert.equal(tokens.tokenType, "Bearer");
      assert.deepEqual(tokens.scopes, ["read", "write"]);
      const delta = tokens.expiresAt!.getTime() - Date.now();
      assert.ok(delta > 3_500_000 && delta <= 3_600_000, `unexpected expiry delta ${delta}`);

      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.equal(request.method, "POST");
      assert.equal(
        request.headers.authorization,
        `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
      );
      const body = new URLSearchParams(request.body);
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "refresh-1");
      assert.equal(body.get("client_id"), null);
      assert.equal(body.get("client_secret"), null);
    },
  );
});

test("uses body client credentials and parses form-encoded responses", async () => {
  await withTokenServer(
    (_request, res) => {
      res.writeHead(200, { "content-type": "application/x-www-form-urlencoded" });
      res.end("access_token=form-token&token_type=bearer&expires_in=60&scope=read");
    },
    async (tokenUrl, requests) => {
      const tokens = await refreshAccessToken(clientFor(tokenUrl, { tokenAuth: "body" }), "refresh-2");
      assert.equal(tokens.accessToken, "form-token");
      assert.equal(tokens.tokenType, "bearer");
      assert.deepEqual(tokens.scopes, ["read"]);
      assert.equal(requests[0].headers.authorization, undefined);
      const body = new URLSearchParams(requests[0].body);
      assert.equal(body.get("client_id"), "client-1");
      assert.equal(body.get("client_secret"), "secret-1");
    },
  );
});

test("exchanges an authorization code with PKCE", async () => {
  await withTokenServer(
    (_request, res) =>
      json(res, 200, { access_token: "code-token", token_type: "Bearer", expires_in: 900, scope: "read" }),
    async (tokenUrl, requests) => {
      const tokens = await exchangeAuthorizationCode(clientFor(tokenUrl), {
        code: "auth-code",
        redirectUri: "https://app.authab.test/api/connect/acme/callback",
        verifier: "verifier-1",
      });
      assert.equal(tokens.accessToken, "code-token");
      const body = new URLSearchParams(requests[0].body);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), "auth-code");
      assert.equal(body.get("redirect_uri"), "https://app.authab.test/api/connect/acme/callback");
      assert.equal(body.get("code_verifier"), "verifier-1");
    },
  );
});

test("classifies token endpoint failures", async () => {
  await withTokenServer(
    (_request, res) => json(res, 400, { error: "invalid_grant", error_description: "refresh token expired" }),
    async (tokenUrl) => {
      try {
        await refreshAccessToken(clientFor(tokenUrl), "stale");
        assert.fail("expected failure");
      } catch (error) {
        assert.ok(error instanceof OAuthTokenError);
        assert.equal(error.code, "invalid_grant");
        assert.equal(error.transient, false);
        assert.match(error.message, /refresh token expired/);
      }
    },
  );

  await withTokenServer(
    (_request, res) => json(res, 503, { error: "temporarily_unavailable" }),
    async (tokenUrl) => {
      try {
        await refreshAccessToken(clientFor(tokenUrl), "later");
        assert.fail("expected failure");
      } catch (error) {
        assert.ok(error instanceof OAuthTokenError);
        assert.equal(error.code, "temporarily_unavailable");
        assert.equal(error.transient, true);
      }
    },
  );

  await withTokenServer(
    (_request, res) => {
      res.writeHead(500, { "content-type": "text/html" });
      res.end("<h1>upstream down</h1>");
    },
    async (tokenUrl) => {
      try {
        await refreshAccessToken(clientFor(tokenUrl), "later");
        assert.fail("expected failure");
      } catch (error) {
        assert.ok(error instanceof OAuthTokenError);
        assert.equal(error.code, "http_500");
        assert.equal(error.transient, true);
      }
    },
  );
});

test("unreachable endpoints surface as transient network errors", async () => {
  await assert.rejects(refreshAccessToken(clientFor("http://127.0.0.1:1/oauth/token"), "rt"), (error: unknown) => {
    assert.ok(error instanceof OAuthTokenError);
    assert.equal(error.code, "network_error");
    assert.equal(error.transient, true);
    return true;
  });
});

test("production never uses the private-network escape hatch", async () => {
  const previous = process.env.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    await assert.rejects(refreshAccessToken(clientFor("http://127.0.0.1:9/oauth/token"), "rt"), /must use HTTPS/);
  } finally {
    mutableEnv.NODE_ENV = previous ?? "test";
  }
});

test("buildAuthorizeUrl includes scopes, PKCE, and extra parameters", () => {
  const url = new URL(
    buildAuthorizeUrl(clientFor("https://acme.example/token", { extraAuthParams: { prompt: "consent" } }), {
      redirectUri: "https://app.authab.test/callback",
      state: "state-1",
      verifier: "verifier-1",
    }),
  );
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.authab.test/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("scope"), "read write");
  assert.equal(url.searchParams.get("code_challenge"), codeChallenge("verifier-1"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("prompt"), "consent");

  const noPkce = new URL(
    buildAuthorizeUrl(clientFor("https://acme.example/token", { pkce: false }), {
      redirectUri: "https://app.authab.test/callback",
      state: "state-2",
      verifier: "verifier-2",
    }),
  );
  assert.equal(noPkce.searchParams.get("code_challenge"), null);
});

test("codeChallenge matches the RFC 7636 S256 vector", () => {
  assert.equal(codeChallenge("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
});

test("normalizeTokens rejects responses without an access token and falls back to client scopes", () => {
  const client = clientFor("https://acme.example/token");
  assert.throws(() => normalizeTokens({ token_type: "Bearer" }, client), /did not return an access token/);
  const tokens = normalizeTokens({ access_token: "a" }, client);
  assert.equal(tokens.tokenType, "Bearer");
  assert.deepEqual(tokens.scopes, ["read", "write"]);
  assert.equal(tokens.expiresAt, undefined);
});

test("SSRF helpers classify private addresses and hostnames", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "172.16.0.1",
    "169.254.1.1",
    "100.64.0.1",
    "192.0.2.10",
    "198.51.100.7",
    "203.0.113.9",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "fc00::1",
    "ff02::1",
    "2001:db8::1",
    "2001:0:53aa:64c::1",
    "2002:a9fe:a9fe::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:7f00:1",
    "::10.0.0.1",
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8", "::ffff:0808:0808"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
  for (const host of ["localhost", "api.local", "service.internal", "box.home.arpa", "localhost."]) {
    assert.equal(privateHostname(host), true, host);
  }
  for (const host of ["api.acme.example", "notlocalhost.example"]) {
    assert.equal(privateHostname(host), false, host);
  }
  for (const host of ["localhost", "metadata", "169.254.169.254", "[::ffff:a9fe:a9fe]", "127.0.0.1."]) {
    assert.equal(isPrivateHost(host), true, host);
  }
  for (const host of ["api.acme.example", "8.8.8.8", "[2606:4700::1111]"]) {
    assert.equal(isPrivateHost(host), false, host);
  }
});
