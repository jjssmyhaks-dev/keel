import { PrismaClient } from "@prisma/client";
import { generateAgentIdentity, encryptSecret, hashPassword, sha256 } from "../src/lib/crypto";
import { auditEvent } from "../src/lib/audit";
import { storeWebhookSecret } from "../src/lib/webhooks";

const db = new PrismaClient();

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function main() {
  console.log("Seeding Keel demo workspace…");

  const existing = await db.organization.findUnique({ where: { slug: "northwind-labs" } });
  if (existing) {
    await db.organization.delete({ where: { id: existing.id } });
  }

  const password = hashPassword("KeelDemo!2026");
  const demo = await db.user.upsert({
    where: { email: "demo@keel.dev" },
    update: {
      passwordHash: password,
      emailVerifiedAt: new Date(),
      onboardedAt: new Date(),
      name: "Ashif Khan",
      avatarUrl: null,
    },
    create: {
      email: "demo@keel.dev",
      name: "Ashif Khan",
      passwordHash: password,
      emailVerifiedAt: new Date(),
      onboardedAt: new Date(),
      timezone: "Asia/Kolkata",
      isPlatformAdmin: true,
    },
  });

  const maya = await db.user.upsert({
    where: { email: "maya@northwind.dev" },
    update: { passwordHash: password, emailVerifiedAt: new Date() },
    create: {
      email: "maya@northwind.dev",
      name: "Maya Iyer",
      passwordHash: password,
      emailVerifiedAt: new Date(),
      timezone: "Asia/Kolkata",
    },
  });
  const rohan = await db.user.upsert({
    where: { email: "rohan@northwind.dev" },
    update: { passwordHash: password, emailVerifiedAt: new Date() },
    create: {
      email: "rohan@northwind.dev",
      name: "Rohan Mehta",
      passwordHash: password,
      emailVerifiedAt: new Date(),
      timezone: "Asia/Kolkata",
    },
  });
  const priya = await db.user.upsert({
    where: { email: "priya@northwind.dev" },
    update: { passwordHash: password, emailVerifiedAt: new Date() },
    create: {
      email: "priya@northwind.dev",
      name: "Priya Nair",
      passwordHash: password,
      emailVerifiedAt: new Date(),
      timezone: "Asia/Kolkata",
    },
  });
  const sam = await db.user.upsert({
    where: { email: "sam@northwind.dev" },
    update: { passwordHash: password, emailVerifiedAt: new Date() },
    create: {
      email: "sam@northwind.dev",
      name: "Sam Rao",
      passwordHash: password,
      emailVerifiedAt: new Date(),
      timezone: "Asia/Kolkata",
    },
  });

  const org = await db.organization.create({
    data: {
      name: "Northwind Labs",
      slug: "northwind-labs",
      plan: "pro",
      billingCurrency: "INR",
      billingEmail: "billing@northwind.dev",
      memberships: {
        create: [
          { userId: demo.id, role: "owner" },
          { userId: maya.id, role: "admin" },
          { userId: rohan.id, role: "developer" },
          { userId: priya.id, role: "approver" },
          { userId: sam.id, role: "viewer" },
        ],
      },
      invitations: {
        create: {
          email: "dev@northwind.dev",
          role: "developer",
          tokenHash: sha256("demo-invite-token"),
          invitedBy: demo.id,
          expiresAt: new Date(Date.now() + 6 * 86400_000),
        },
      },
    },
  });

  const project = await db.project.create({
    data: {
      orgId: org.id,
      name: "Agent Platform",
      environments: {
        create: [
          {
            type: "development",
            settingsJson: JSON.stringify({
              autoApproveDev: true,
              approvalExpiryMinutes: 60,
              defaultOutcome: "deny",
              mockMode: true,
              agentRateLimitPerMinute: 120,
              escalateAfterMinutes: 30,
            }),
          },
          {
            type: "production",
            settingsJson: JSON.stringify({
              autoApproveDev: false,
              approvalExpiryMinutes: 30,
              defaultOutcome: "deny",
              mockMode: false,
              agentRateLimitPerMinute: 600,
              escalateAfterMinutes: 15,
              allowedDomains: "northwind.dev",
            }),
            productionUnlockedAt: new Date(Date.now() - 12 * 86400_000),
          },
        ],
      },
    },
    include: { environments: true },
  });
  const dev = project.environments.find((e) => e.type === "development")!;
  const prod = project.environments.find((e) => e.type === "production")!;

  const demoKeys = {
    devSecret: "sk_dev_demo_northwind_2026",
    prodSecret: "sk_prod_demo_northwind_2026",
    devPublishable: "pk_dev_demo_northwind_2026",
    prodPublishable: "pk_prod_demo_northwind_2026",
  };

  for (const [env, secret, publishable] of [
    [dev, demoKeys.devSecret, demoKeys.devPublishable],
    [prod, demoKeys.prodSecret, demoKeys.prodPublishable],
  ] as const) {
    await db.apiKey.createMany({
      data: [
        {
          environmentId: env.id,
          name: "Server secret key",
          type: "secret",
          keyHash: sha256(secret),
          prefix: `${secret.slice(0, 12)}…${secret.slice(-4)}`,
          lastUsedAt: minutesAgo(3),
        },
        {
          environmentId: env.id,
          name: "Client publishable key",
          type: "publishable",
          keyHash: sha256(publishable),
          prefix: `${publishable.slice(0, 12)}…${publishable.slice(-4)}`,
        },
      ],
    });
  }

  async function createAgent(opts: {
    id: string;
    env: typeof dev;
    name: string;
    description: string;
    ownerId: string;
    status?: string;
    tags: string[];
    framework?: string;
    autonomous?: boolean;
    lastActiveMinutes?: number;
    promotedFrom?: string;
    safeLaunchDays?: number;
  }) {
    const identity = generateAgentIdentity();
    const wrapped = await encryptSecret(project.id, { privateKey: identity.privateKey });
    const agent = await db.agent.create({
      data: {
        id: opts.id,
        environmentId: opts.env.id,
        name: opts.name,
        description: opts.description,
        ownerUserId: opts.ownerId,
        status: opts.status ?? "active",
        publicKey: identity.publicKey,
        fingerprint: identity.fingerprint,
        keyMode: "platform",
        tagsJson: JSON.stringify(opts.tags),
        framework: opts.framework,
        autonomousMode: opts.autonomous ?? false,
        promotedFromAgentId: opts.promotedFrom,
        lastActiveAt: opts.lastActiveMinutes ? minutesAgo(opts.lastActiveMinutes) : null,
        safeLaunchUntil: opts.safeLaunchDays
          ? new Date(Date.now() + opts.safeLaunchDays * 86400_000)
          : null,
        keys: {
          create: {
            publicKey: identity.publicKey,
            encryptedPrivateKey: JSON.stringify(wrapped),
            status: "active",
          },
        },
      },
    });
    return agent;
  }

  const atlas = await createAgent({
    id: "agt_atlas",
    env: dev,
    name: "Atlas Research",
    description: "Reads customer conversations and drafts research briefs for the product team.",
    ownerId: demo.id,
    tags: ["research", "customer-facing"],
    framework: "LangGraph",
    lastActiveMinutes: 2,
  });
  const concierge = await createAgent({
    id: "agt_concierge",
    env: dev,
    name: "Concierge Support",
    description: "Front-line support agent. Triages tickets, replies to customers and updates the CRM.",
    ownerId: demo.id,
    tags: ["support", "customer-facing", "tier-1"],
    framework: "OpenAI Agents SDK",
    lastActiveMinutes: 1,
  });
  const ledger = await createAgent({
    id: "agt_ledger",
    env: dev,
    name: "Ledger Ops",
    description: "Reconciles payments and prepares refunds. Financial actions require human approval.",
    ownerId: maya.id,
    tags: ["finance", "sensitive"],
    framework: "CrewAI",
    lastActiveMinutes: 17,
  });
  const digest = await createAgent({
    id: "agt_digest",
    env: dev,
    name: "Nightly Digest",
    description: "Summarizes the day's inbox and sends a digest at 23:00 IST.",
    ownerId: rohan.id,
    status: "paused",
    tags: ["internal"],
    lastActiveMinutes: 640,
  });
  const sentinel = await createAgent({
    id: "agt_sentinel",
    env: dev,
    name: "Ops Sentinel",
    description: "Watches deployment health and opens issues on regressions.",
    ownerId: rohan.id,
    status: "suspended",
    tags: ["platform"],
    lastActiveMinutes: 2600,
  });
  const scout = await createAgent({
    id: "agt_scout",
    env: dev,
    name: "Atlas Scout",
    description: "A delegated helper that only posts approved summaries to #research.",
    ownerId: demo.id,
    tags: ["delegated", "research"],
    framework: "LangGraph",
    lastActiveMinutes: 44,
  });

  const atlasProd = await createAgent({
    id: "agt_atlas_prod",
    env: prod,
    name: "Atlas Research",
    description: "Production identity for Atlas. Promoted from development 12 days ago.",
    ownerId: demo.id,
    tags: ["research", "customer-facing"],
    framework: "LangGraph",
    lastActiveMinutes: 5,
    promotedFrom: atlas.id,
    safeLaunchDays: 14,
  });
  const conciergeProd = await createAgent({
    id: "agt_concierge_prod",
    env: prod,
    name: "Concierge Support",
    description: "Production identity for the support agent.",
    ownerId: demo.id,
    tags: ["support", "customer-facing"],
    framework: "OpenAI Agents SDK",
    lastActiveMinutes: 9,
    promotedFrom: concierge.id,
  });

  await db.agent.update({
    where: { id: atlasProd.id },
    data: { createdAt: new Date(Date.now() - 12 * 86400_000) },
  });

  const credentials: Record<string, { id: string; env: typeof dev; connectorSlug: string }> = {};
  async function createCredential(opts: {
    id: string;
    env: typeof dev;
    connectorSlug: string;
    name: string;
    secret: Record<string, unknown>;
    mask: string;
    type: string;
    status?: string;
    healthDetail?: string;
    expiresInDays?: number;
    lastUsedMinutes?: number;
    createdBy?: string;
  }) {
    const encrypted = await encryptSecret(project.id, opts.secret);
    const credential = await db.credential.create({
      data: {
        id: opts.id,
        environmentId: opts.env.id,
        connectorSlug: opts.connectorSlug,
        name: opts.name,
        type: opts.type,
        encryptedPayload: encrypted.encryptedPayload,
        dataKeyEncrypted: encrypted.dataKeyEncrypted,
        metadataJson: JSON.stringify({
          connectedAt: new Date().toISOString(),
          scopes: opts.connectorSlug === "slack" ? ["channels:read", "chat:write"] : undefined,
        }),
        maskedHint: opts.mask,
        status: opts.status ?? "healthy",
        healthDetail: opts.healthDetail,
        expiresAt: opts.expiresInDays
          ? new Date(Date.now() + opts.expiresInDays * 86400_000)
          : null,
        lastUsedAt: opts.lastUsedMinutes ? minutesAgo(opts.lastUsedMinutes) : null,
        createdBy: opts.createdBy ?? demo.id,
        createdAt: new Date(Date.now() - 20 * 86400_000),
        healthEvents: {
          create: [
            {
              result: opts.status === "broken" ? "failed" : "ok",
              detail: opts.healthDetail ?? "Token valid, required scopes present.",
              checkedAt: minutesAgo(18),
            },
          ],
        },
      },
    });
    credentials[opts.id] = { id: credential.id, env: opts.env, connectorSlug: opts.connectorSlug };
    return credential;
  }

  const slackCred = await createCredential({
    id: "cred_slack",
    env: dev,
    connectorSlug: "slack",
    name: "Northwind workspace",
    secret: { accessToken: "xoxb-demo-4481201932-keel", refreshToken: "xoxr-demo", scopes: ["channels:read", "chat:write", "files:write"] },
    mask: "••••932",
    type: "oauth",
    expiresInDays: 27,
    lastUsedMinutes: 1,
  });
  const githubCred = await createCredential({
    id: "cred_github",
    env: dev,
    connectorSlug: "github",
    name: "acme-ci (fine-grained)",
    secret: { token: "github_pat_demo_11ABC", login: "northwind-bot" },
    mask: "••••1ABC",
    type: "api_key",
    lastUsedMinutes: 26,
  });
  const gmailCred = await createCredential({
    id: "cred_gmail",
    env: dev,
    connectorSlug: "google",
    name: "support@northwind.dev",
    secret: { accessToken: "ya29.demo-google", refreshToken: "1//demo-refresh", scopes: ["gmail.send", "gmail.readonly"] },
    mask: "••••mail",
    type: "oauth",
    expiresInDays: 6,
    lastUsedMinutes: 4,
  });
  const stripeCred = await createCredential({
    id: "cred_stripe",
    env: dev,
    connectorSlug: "stripe",
    name: "Northwind payments",
    secret: { apiKey: "rk_live_demo_51Qx", mode: "restricted" },
    mask: "••••51Qx",
    type: "api_key",
    lastUsedMinutes: 17,
  });
  const openaiCred = await createCredential({
    id: "cred_openai",
    env: dev,
    connectorSlug: "openai",
    name: "Atlas model access",
    secret: { apiKey: "sk-proj-demo-atlas" },
    mask: "••••tlas",
    type: "api_key",
    lastUsedMinutes: 8,
  });
  const hubspotCred = await createCredential({
    id: "cred_hubspot",
    env: dev,
    connectorSlug: "hubspot",
    name: "Revenue CRM",
    secret: { accessToken: "pat-demo-hubspot", portalId: "24519201" },
    mask: "••••9201",
    type: "oauth",
    expiresInDays: 2,
    lastUsedMinutes: 33,
  });
  const notionCred = await createCredential({
    id: "cred_notion_broken",
    env: dev,
    connectorSlug: "notion",
    name: "Ops wiki (legacy)",
    secret: { accessToken: "secret_demo_notion" },
    mask: "••••tion",
    type: "oauth",
    status: "broken",
    healthDetail: "Refresh token was revoked by the workspace owner on 28 Oct.",
    lastUsedMinutes: 4100,
  });

  const prodSlack = await createCredential({
    id: "cred_slack_prod",
    env: prod,
    connectorSlug: "slack",
    name: "Northwind workspace (prod)",
    secret: { accessToken: "xoxb-prod-demo-9182", scopes: ["channels:read", "chat:write"] },
    mask: "••••9182",
    type: "oauth",
    lastUsedMinutes: 9,
  });
  const prodGmail = await createCredential({
    id: "cred_gmail_prod",
    env: prod,
    connectorSlug: "google",
    name: "support@northwind.dev (prod)",
    secret: { accessToken: "ya29.prod-demo", scopes: ["gmail.send", "gmail.readonly"] },
    mask: "••••mail",
    type: "oauth",
    lastUsedMinutes: 14,
  });
  const prodStripe = await createCredential({
    id: "cred_stripe_prod",
    env: prod,
    connectorSlug: "stripe",
    name: "Northwind live payments",
    secret: { apiKey: "rk_live_demo_prod_91K", mode: "restricted" },
    mask: "••••91K",
    type: "api_key",
    lastUsedMinutes: 60,
  });

  type GrantSeed = {
    id: string;
    agentId: string;
    credentialId: string;
    actions: string[];
    resource: string;
    approvalMode?: string;
    conditions?: Record<string, unknown>;
    purpose?: string;
    expiresInDays?: number;
    createdDaysAgo?: number;
  };

  const grantSeeds: GrantSeed[] = [
    {
      id: "grant_atlas_slack",
      agentId: atlas.id,
      credentialId: slackCred.id,
      actions: ["slack.list_channels", "slack.read_channel", "slack.post_message"],
      resource: "research-*",
      purpose: "Post research summaries to the research channels",
      createdDaysAgo: 18,
    },
    {
      id: "grant_atlas_github",
      agentId: atlas.id,
      credentialId: githubCred.id,
      actions: ["github.list_repos", "github.create_issue", "github.comment_issue"],
      resource: "acme/*",
      createdDaysAgo: 18,
    },
    {
      id: "grant_atlas_openai",
      agentId: atlas.id,
      credentialId: openaiCred.id,
      actions: ["openai.list_models", "openai.chat_completion"],
      resource: "gpt-4.1-*",
      approvalMode: "allow",
      purpose: "Flexible model access for research synthesis",
      createdDaysAgo: 16,
    },
    {
      id: "grant_concierge_slack",
      agentId: concierge.id,
      credentialId: slackCred.id,
      actions: ["slack.list_channels", "slack.read_channel", "slack.post_message"],
      resource: "support-*",
      purpose: "Reply in support channels only",
      createdDaysAgo: 15,
    },
    {
      id: "grant_concierge_gmail",
      agentId: concierge.id,
      credentialId: gmailCred.id,
      actions: ["gmail.list_messages", "gmail.read_message", "gmail.create_draft", "gmail.send_message"],
      resource: "support@northwind.dev",
      purpose: "Handle the support inbox",
      createdDaysAgo: 15,
    },
    {
      id: "grant_concierge_hubspot",
      agentId: concierge.id,
      credentialId: hubspotCred.id,
      actions: ["hubspot.list_contacts", "hubspot.create_contact", "hubspot.update_deal"],
      resource: "contacts/*",
      createdDaysAgo: 12,
    },
    {
      id: "grant_ledger_stripe",
      agentId: ledger.id,
      credentialId: stripeCred.id,
      actions: ["stripe.list_charges", "stripe.list_customers", "stripe.create_refund", "stripe.create_payment_link"],
      resource: "acct_northwind",
      approvalMode: "require_approval",
      purpose: "Refunds and payment links need a human decision",
      conditions: { maxCallsPerPeriod: 40, periodHours: 24 },
      createdDaysAgo: 11,
    },
    {
      id: "grant_digest_gmail",
      agentId: digest.id,
      credentialId: gmailCred.id,
      actions: ["gmail.list_messages", "gmail.read_message"],
      resource: "support@northwind.dev",
      createdDaysAgo: 9,
    },
    {
      id: "grant_sentinel_github",
      agentId: sentinel.id,
      credentialId: githubCred.id,
      actions: ["github.list_repos", "github.create_issue"],
      resource: "acme/*",
      createdDaysAgo: 21,
    },
    {
      id: "grant_scout_slack",
      agentId: scout.id,
      credentialId: slackCred.id,
      actions: ["slack.post_message"],
      resource: "research-*",
      purpose: "Delegated summaries only",
      createdDaysAgo: 4,
      expiresInDays: 20,
    },
    {
      id: "grant_atlas_prod_slack",
      agentId: atlasProd.id,
      credentialId: prodSlack.id,
      actions: ["slack.list_channels", "slack.read_channel", "slack.post_message"],
      resource: "research-*",
      createdDaysAgo: 12,
    },
    {
      id: "grant_concierge_prod_gmail",
      agentId: conciergeProd.id,
      credentialId: prodGmail.id,
      actions: ["gmail.list_messages", "gmail.read_message", "gmail.send_message"],
      resource: "support@northwind.dev",
      createdDaysAgo: 12,
    },
    {
      id: "grant_concierge_prod_slack",
      agentId: conciergeProd.id,
      credentialId: prodSlack.id,
      actions: ["slack.post_message", "slack.read_channel"],
      resource: "support-*",
      createdDaysAgo: 12,
    },
    {
      id: "grant_atlas_prod_stripe",
      agentId: atlasProd.id,
      credentialId: prodStripe.id,
      actions: ["stripe.list_charges"],
      resource: "acct_northwind",
      createdDaysAgo: 3,
    },
  ];

  for (const seed of grantSeeds) {
    const grant = await db.grant.create({
      data: {
        id: seed.id,
        environmentId: credentials[seed.credentialId]!.env.id,
        agentId: seed.agentId,
        credentialId: seed.credentialId,
        actionsJson: JSON.stringify(seed.actions),
        resourcePattern: seed.resource,
        conditionsJson: JSON.stringify(seed.conditions ?? {}),
        approvalMode: seed.approvalMode,
        purpose: seed.purpose,
        createdBy: demo.id,
        createdAt: new Date(Date.now() - (seed.createdDaysAgo ?? 7) * 86400_000),
        expiresAt: seed.expiresInDays ? new Date(Date.now() + seed.expiresInDays * 86400_000) : null,
      },
    });
    const credential = Object.values(credentials).find((c) => c.id === seed.credentialId);
    await db.permissionChange.create({
      data: {
        environmentId: grant.environmentId,
        agentId: seed.agentId,
        credentialId: seed.credentialId,
        actorId: demo.id,
        actorName: "Ashif Khan",
        change: "Grant created",
        beforeJson: "{}",
        afterJson: JSON.stringify({ actions: seed.actions, resource: seed.resource }),
        createdAt: grant.createdAt,
      },
    }).catch(() => null);
    void credential;
  }

  await db.approvalPolicy.createMany({
    data: [
      {
        environmentId: dev.id,
        agentId: concierge.id,
        actionPattern: "gmail.send_message",
        mode: "require_approval",
      },
      {
        environmentId: dev.id,
        agentId: null,
        actionPattern: "stripe.*",
        mode: "require_approval",
      },
      {
        environmentId: prod.id,
        agentId: conciergeProd.id,
        actionPattern: "gmail.send_message",
        mode: "require_approval",
      },
      {
        environmentId: prod.id,
        agentId: atlasProd.id,
        actionPattern: "openai.*",
        mode: "require_approval",
      },
    ],
  });

  await db.delegation.create({
    data: {
      environmentId: dev.id,
      parentAgentId: atlas.id,
      childAgentId: scout.id,
      scopesJson: JSON.stringify(["slack.post_message"]),
      restrictionsJson: JSON.stringify({ resourceSubset: "research-*", maxCalls: 200 }),
      depth: 1,
      purpose: "Summarize research threads and post the digest",
      expiresAt: new Date(Date.now() + 20 * 86400_000),
      createdAt: new Date(Date.now() - 4 * 86400_000),
    },
  });

  const approvals = [
    {
      id: "apr_refund_42",
      env: dev,
      agent: ledger,
      grantId: "grant_ledger_stripe",
      credentialId: stripeCred.id,
      action: "stripe.create_refund",
      summary: "Refund $42.00 to customer cus_Qx91 for charge ch_3Qx9a2Lk",
      risk: "financial",
      payload: { charge: "ch_3Qx9a2Lk", amount: 4200, currency: "usd", customer: "cus_Qx91", reason: "duplicate_charge" },
      status: "pending",
      minutes: 42,
      expiresIn: 18,
      token: "apr_token_refund_42",
    },
    {
      id: "apr_email_client",
      env: dev,
      agent: concierge,
      grantId: "grant_concierge_gmail",
      credentialId: gmailCred.id,
      action: "gmail.send_message",
      summary: "Send email to client@acme.com — “Your support ticket is resolved”",
      risk: "write",
      payload: { to: "client@acme.com", subject: "Your support ticket is resolved", body: "Hi there, the billing issue you reported is fixed. — Northwind Support" },
      status: "pending",
      minutes: 12,
      expiresIn: 48,
      token: "apr_token_email_client",
    },
    {
      id: "apr_slack_launch",
      env: dev,
      agent: atlas,
      grantId: "grant_atlas_slack",
      credentialId: slackCred.id,
      action: "slack.post_message",
      summary: "Post message to #research-launch — “Launch brief v3 is ready for review”",
      risk: "write",
      payload: { channel: "#research-launch", text: "Launch brief v3 is ready for review. Summary: positioning, pricing and rollout risks." },
      status: "pending",
      minutes: 4,
      expiresIn: 56,
      token: "apr_token_slack_launch",
    },
    {
      id: "apr_prod_refund",
      env: prod,
      agent: atlasProd,
      grantId: "grant_atlas_prod_stripe",
      credentialId: prodStripe.id,
      action: "stripe.list_charges",
      summary: "List recent charges for reconciliation",
      risk: "read",
      payload: { limit: 10 },
      status: "approved",
      minutes: 95,
      expiresIn: 20,
      token: "apr_token_prod_charges",
      decidedMinutes: 88,
    },
    {
      id: "apr_denied_link",
      env: dev,
      agent: ledger,
      grantId: "grant_ledger_stripe",
      credentialId: stripeCred.id,
      action: "stripe.create_payment_link",
      summary: "Create a $1,200 payment link for invoice INV-2214",
      risk: "financial",
      payload: { amount: 120000, currency: "usd", description: "Invoice INV-2214" },
      status: "denied",
      minutes: 310,
      expiresIn: 20,
      token: "apr_token_denied_link",
      decidedMinutes: 280,
      note: "Invoice was already paid by bank transfer.",
    },
    {
      id: "apr_expired_issue",
      env: dev,
      agent: sentinel,
      grantId: "grant_sentinel_github",
      credentialId: githubCred.id,
      action: "github.create_issue",
      summary: "Open issue in acme/checkout — “Elevated 5xx on /pay”",
      risk: "write",
      payload: { repo: "acme/checkout", title: "Elevated 5xx on /pay" },
      status: "expired",
      minutes: 1500,
      expiresIn: -1200,
      token: "apr_token_expired_issue",
    },
  ] as const;

  for (const approval of approvals) {
    const envId = approval.env === prod ? prod.id : dev.id;
    const createdAt = minutesAgo(approval.minutes);
    await db.approvalRequest.create({
      data: {
        id: approval.id,
        environmentId: envId,
        agentId: approval.agent.id,
        grantId: approval.grantId,
        credentialId: approval.credentialId,
        action: approval.action,
        summary: approval.summary,
        payloadJson: JSON.stringify(approval.payload),
        redactedJson: JSON.stringify(approval.payload),
        risk: approval.risk,
        status: approval.status,
        token: approval.token,
        requestId: `req_${approval.id.replace("apr_", "")}`,
        expiresAt: approval.status === "pending" ? new Date(Date.now() + approval.expiresIn * 60_000) : new Date(createdAt.getTime() + Math.max(approval.expiresIn, 1) * 60_000),
        decidedBy: "decidedMinutes" in approval ? priya.id : null,
        decidedAt: "decidedMinutes" in approval ? minutesAgo(approval.decidedMinutes) : null,
        decisionNote: "note" in approval ? approval.note : null,
        createdAt,
      },
    });
    await auditEvent({
      environmentId: envId,
      actorType: "agent",
      actorId: approval.agent.id,
      actorName: approval.agent.name,
      action: "approval.requested",
      resourceType: "approval",
      resourceId: approval.id,
      outcome: "recorded",
      requestId: `req_${approval.id.replace("apr_", "")}`,
      agentId: approval.agent.id,
      timestamp: createdAt,
      payloadSummary: { action: approval.action, risk: approval.risk, summary: approval.summary },
    });
    if ("decidedMinutes" in approval) {
      await auditEvent({
        environmentId: envId,
        actorType: "human",
        actorId: priya.id,
        actorName: "Priya Nair",
        action: "approval.decided",
        resourceType: "approval",
        resourceId: approval.id,
        outcome: approval.status === "approved" ? "approved" : "denied",
        agentId: approval.agent.id,
        timestamp: minutesAgo(approval.decidedMinutes),
        payloadSummary: { decision: approval.status, action: approval.action },
      });
    }
  }

  const activity = [
    { agent: atlas, connector: "slack", action: "slack.read_channel", risk: "read", resource: "#research-customer", latency: 184 },
    { agent: atlas, connector: "openai", action: "openai.chat_completion", risk: "financial", resource: "gpt-4.1-mini", latency: 912 },
    { agent: atlas, connector: "github", action: "github.create_issue", risk: "write", resource: "acme/checkout#142", latency: 268 },
    { agent: concierge, connector: "slack", action: "slack.post_message", risk: "write", resource: "#support-billing", latency: 201 },
    { agent: concierge, connector: "google", action: "gmail.read_message", risk: "read", resource: "18c2b7f9", latency: 244 },
    { agent: concierge, connector: "hubspot", action: "hubspot.create_contact", risk: "write", resource: "contacts/5128491", latency: 322 },
    { agent: ledger, connector: "stripe", action: "stripe.list_charges", risk: "read", resource: "acct_northwind", latency: 176 },
    { agent: ledger, connector: "stripe", action: "stripe.create_refund", risk: "financial", resource: "acct_northwind", latency: 491 },
    { agent: atlasProd, connector: "slack", action: "slack.post_message", risk: "write", resource: "#research-launch", latency: 233 },
    { agent: conciergeProd, connector: "google", action: "gmail.send_message", risk: "write", resource: "support@northwind.dev", latency: 512 },
    { agent: atlasProd, connector: "stripe", action: "stripe.list_charges", risk: "read", resource: "acct_northwind", latency: 198 },
    { agent: scout, connector: "slack", action: "slack.post_message", risk: "write", resource: "#research-digest", latency: 209 },
  ];

  const events: {
    timestamp: Date;
    item: (typeof activity)[number];
    outcome: string;
    env: typeof dev;
  }[] = [];

  for (let i = 0; i < 96; i++) {
    const hoursAgo = Math.pow(rand(), 1.6) * 24;
    const item = pick(activity.filter((a) => a.agent.environmentId === dev.id && a.agent.status === "active"));
    const outcome =
      rand() < 0.82 ? "allowed" : rand() < 0.55 ? "approved" : rand() < 0.75 ? "denied" : "error";
    events.push({ timestamp: minutesAgo(hoursAgo * 60), item, outcome, env: dev });
  }
  for (let i = 0; i < 54; i++) {
    const item = pick(activity.filter((a) => a.agent.environmentId === prod.id));
    const outcome = rand() < 0.86 ? "allowed" : rand() < 0.7 ? "approved" : "denied";
    events.push({
      timestamp: minutesAgo((24 + rand() * 120) * 60),
      item,
      outcome,
      env: prod,
    });
  }
  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const credentialByEnvConnector = new Map(
    Object.values(credentials).map((credential) => [`${credential.env.id}:${credential.connectorSlug}`, credential.id]),
  );

  for (const event of events) {
    const { item } = event;
    await auditEvent({
      environmentId: event.env.id,
      actorType: "agent",
      actorId: item.agent.id,
      actorName: item.agent.name,
      action: "proxy.call",
      resourceType: "connector",
      resourceId: item.connector,
      outcome: event.outcome as "allowed" | "approved" | "denied" | "error",
      agentId: item.agent.id,
      timestamp: event.timestamp,
      chain:
        item.agent.id === scout.id
          ? [
              { agentId: atlas.id, name: "Atlas Research" },
              { agentId: scout.id, name: "Atlas Scout" },
            ]
          : [],
      payloadSummary: {
        action: item.action,
        connector: item.connector,
        credentialId: credentialByEnvConnector.get(`${event.env.id}:${item.connector}`),
        risk: item.risk,
        resource: item.resource,
        latencyMs: item.latency,
        upstreamStatus: event.outcome === "error" ? 502 : 200,
        decision: event.outcome,
      },
    });
  }

  await auditEvent({
    environmentId: dev.id,
    actorType: "human",
    actorId: demo.id,
    actorName: "Ashif Khan",
    action: "auth.login",
    resourceType: "session",
    resourceId: demo.id,
    outcome: "recorded",
    timestamp: minutesAgo(2),
    payloadSummary: { method: "password", device: "MacBook Pro · Chrome" },
  });

  await auditEvent({
    environmentId: dev.id,
    actorType: "human",
    actorId: maya.id,
    actorName: "Maya Iyer",
    action: "credential.created",
    resourceType: "credential",
    resourceId: notionCred.id,
    outcome: "recorded",
    timestamp: minutesAgo(4100),
    payloadSummary: { connector: "notion", name: "Ops wiki (legacy)" },
  });

  await db.webhookEndpoint.create({
    data: {
      environmentId: dev.id,
      url: "https://hooks.northwind.dev/keel",
      secret: await storeWebhookSecret(project.id, "whsec_demo_northwind_hook"),
      eventsJson: JSON.stringify(["approval.requested", "approval.decided", "agent.status_changed", "credential.expiring"]),
      status: "active",
      lastDeliveryAt: minutesAgo(37),
      deliveries: {
        create: [
          {
            eventId: "evt_demo_1",
            event: "approval.requested",
            payload: JSON.stringify({ id: "evt_demo_1", event: "approval.requested" }),
            statusCode: 200,
            deliveredAt: minutesAgo(42),
          },
          {
            eventId: "evt_demo_2",
            event: "approval.decided",
            payload: JSON.stringify({ id: "evt_demo_2", event: "approval.decided" }),
            statusCode: 502,
            error: "HTTP 502",
            attempt: 2,
            nextRetryAt: minutesAgo(-8),
          },
        ],
      },
    },
  });

  await db.usageRecord.createMany({
    data: [
      { orgId: org.id, metric: "proxy_calls", quantity: 18432, period: "2026-10" },
      { orgId: org.id, metric: "active_agents", quantity: 4, period: "2026-10" },
      { orgId: org.id, metric: "credentials", quantity: 9, period: "2026-10" },
      { orgId: org.id, metric: "proxy_calls", quantity: 16210, period: "2026-09" },
    ],
  });

  await db.invoice.createMany({
    data: [
      { orgId: org.id, number: "KEEL-2026-0042", amount: 399900, currency: "INR", status: "paid", issuedAt: new Date("2026-10-01") },
      { orgId: org.id, number: "KEEL-2026-0031", amount: 399900, currency: "INR", status: "paid", issuedAt: new Date("2026-09-01") },
      { orgId: org.id, number: "KEEL-2026-0020", amount: 399900, currency: "INR", status: "paid", issuedAt: new Date("2026-08-01") },
    ],
  });

  await db.notification.createMany({
    data: [
      {
        orgId: org.id,
        userId: demo.id,
        type: "approval",
        title: "Refund waiting for approval",
        body: "Ledger Ops requested a $42.00 refund on Northwind payments.",
        href: "/app/approvals",
        createdAt: minutesAgo(42),
      },
      {
        orgId: org.id,
        userId: demo.id,
        type: "credential",
        title: "Notion connection is broken",
        body: "Ops wiki (legacy) lost access. Re-authorize to keep syncing.",
        href: "/app/vault",
        createdAt: minutesAgo(240),
      },
      {
        orgId: org.id,
        userId: demo.id,
        type: "credential",
        title: "HubSpot credential expires in 2 days",
        body: "Revenue CRM refresh token expires on 1 Nov.",
        href: "/app/vault",
        createdAt: minutesAgo(300),
      },
      {
        orgId: org.id,
        userId: demo.id,
        type: "alert",
        title: "Concierge Support is calling a new host",
        body: "A call to a host outside the connector allow-list was blocked.",
        href: "/app/activity",
        readAt: minutesAgo(500),
        createdAt: minutesAgo(610),
      },
    ],
  });

  await db.alertRule.createMany({
    data: [
      {
        environmentId: prod.id,
        type: "call_spike",
        configJson: JSON.stringify({ threshold: 3, windowMinutes: 60 }),
        channelsJson: JSON.stringify(["email", "slack"]),
      },
      {
        environmentId: prod.id,
        type: "repeated_denials",
        configJson: JSON.stringify({ threshold: 5, windowMinutes: 15 }),
        channelsJson: JSON.stringify(["email"]),
      },
      {
        environmentId: dev.id,
        type: "new_host",
        configJson: JSON.stringify({}),
        channelsJson: JSON.stringify(["email"]),
      },
    ],
  });

  await auditEvent({
    environmentId: dev.id,
    actorType: "human",
    actorId: demo.id,
    actorName: "Ashif Khan",
    action: "webhook.created",
    resourceType: "webhook",
    resourceId: "demo",
    outcome: "recorded",
    timestamp: minutesAgo(600),
    payloadSummary: { url: "https://hooks.northwind.dev/keel" },
  });

  await auditEvent({
    environmentId: prod.id,
    actorType: "human",
    actorId: demo.id,
    actorName: "Ashif Khan",
    action: "promotion.completed",
    resourceType: "agent",
    resourceId: atlasProd.id,
    outcome: "recorded",
    timestamp: new Date(Date.now() - 12 * 86400_000),
    payloadSummary: { devAgent: "Atlas Research", prodAgent: "Atlas Research", safeLaunch: true },
  });

  const counts = {
    users: await db.user.count(),
    agents: await db.agent.count(),
    credentials: await db.credential.count(),
    grants: await db.grant.count(),
    approvals: await db.approvalRequest.count(),
    audit: await db.auditEvent.count(),
  };
  console.log("Seed complete", counts);
  console.log("Demo login: demo@keel.dev / KeelDemo!2026");
  console.log("Dev API key:", demoKeys.devSecret);
}

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "1") {
  console.error("Refusing to seed demo credentials in production. Set ALLOW_DEMO_SEED=1 only for disposable demo deployments.");
  process.exit(1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
