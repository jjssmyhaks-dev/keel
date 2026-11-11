export type Subprocessor = {
  name: string;
  location: string;
  purpose: string;
  safeguards: string;
};

export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "Neon",
    location: "AWS ap-southeast-1 (Singapore)",
    purpose: "Managed Postgres for workspace metadata, credential ciphertext and the audit chain",
    safeguards: "GDPR, SCCs",
  },
  {
    name: "Resend",
    location: "United States",
    purpose: "Transactional email — sign-in links, invitations, approval requests and security alerts",
    safeguards: "SCCs",
  },
  {
    name: "Stripe",
    location: "United States",
    purpose: "Subscription billing, invoices, payment details and tax calculation when a paid plan is active",
    safeguards: "PCI DSS, SCCs",
  },
];

export const IDENTITY_PROVIDERS = [
  {
    name: "Google",
    detail: "Optional social sign-in. Receives the OAuth request and returns name, email and a stable subject id.",
  },
  {
    name: "GitHub",
    detail: "Optional social sign-in. Receives the OAuth request and returns name, email and a stable subject id.",
  },
  {
    name: "Your identity provider",
    detail: "Enterprise SSO (OIDC or SAML) is configured by you and authenticates against your IdP, not ours.",
  },
];

export const TRUST_UPDATED = "11 November 2026";
