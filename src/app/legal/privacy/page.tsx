import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Privacy — Keel",
  description: "What Keel collects, why, how long we keep it, and the choices you have.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      slug="privacy"
      eyebrow="Privacy"
      title="What we hold, and why."
      intro="Keel processes three kinds of data: your account, your workspace configuration, and operational records created when your agents make calls. This page explains each one in the order it enters the system."
      updated="24 October 2026"
    >
      <h2 id="summary">The short version</h2>
      <p>
        We collect what is needed to run the service and nothing more. We do not sell data, we do not train models on
        your traffic, and we do not read decrypted credentials. You can export or delete almost everything through the
        dashboard or API, and deletion is real deletion — not a flag.
      </p>

      <h2 id="controller">Who is responsible</h2>
      <p>
        Keel Systems Pvt Ltd (&ldquo;Keel&rdquo;, &ldquo;we&rdquo;) is the controller for account and billing data, and the processor for
        workspace data that customers upload. Our registered office is Keel Systems Pvt Ltd, 4th Floor, 12th Main,
        Indiranagar, Bengaluru 560038, India. The EU representative for GDPR purposes is listed on request at{" "}
        <a href="mailto:legal@keel.dev">legal@keel.dev</a>.
      </p>
      <p>
        Where we act as a processor, the <Link href="/legal/dpa">data processing agreement</Link> governs the
        relationship and prevails over this page for workspace data.
      </p>

      <h2 id="collected">What we collect</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Examples</th>
            <th>Purpose</th>
            <th>Retention</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Account</td>
            <td>Name, email, organisation, role, authentication events</td>
            <td>Operate the account, secure sign-in, notify you of security and billing events</td>
            <td>Life of the account, then 30 days</td>
          </tr>
          <tr>
            <td>Billing</td>
            <td>Plan, seats, invoices, tax identifiers, payment method tokens</td>
            <td>Charge for the service and meet accounting obligations</td>
            <td>7 years, as required by tax law</td>
          </tr>
          <tr>
            <td>Workspace configuration</td>
            <td>Agents, connectors, grants, policies, environment settings</td>
            <td>Run the control plane you configured</td>
            <td>Until you delete it</td>
          </tr>
          <tr>
            <td>Encrypted credentials</td>
            <td>Provider API keys, OAuth tokens, service accounts</td>
            <td>Inject credentials into proxied calls without exposing them to agents</td>
            <td>Until you revoke them</td>
          </tr>
          <tr>
            <td>Operational records</td>
            <td>Proxy requests, policy decisions, approvals, audit events, hashes</td>
            <td>Enforce policy, produce approvals, keep a verifiable audit trail</td>
            <td>Per your plan&apos;s retention, 7–365 days by default</td>
          </tr>
          <tr>
            <td>Support and marketing</td>
            <td>Emails, chat transcripts, optional product analytics</td>
            <td>Answer you, improve the product, send updates you opted into</td>
            <td>2 years, or until you unsubscribe</td>
          </tr>
        </tbody>
      </table>
      <p>
        We do not collect payment card numbers. Card data is handled by Stripe or Razorpay and never reaches Keel
        servers. Product analytics are aggregate and do not include prompt content, response bodies or credentials.
      </p>

      <h2 id="credentials">A note on credentials and payloads</h2>
      <p>
        Vault entries are encrypted with envelope encryption before they touch storage. The database holds ciphertext
        and wrapped keys; the master key lives in the deployment secret store. Decryption happens in memory for the
        duration of a proxied call and is not logged.
      </p>
      <p>
        Approval requests store a <em>redacted</em> summary of the call — action, resource, and argument keys with
        secret-shaped values removed. Full request and response bodies are stored only when your retention settings
        say so, and are encrypted at rest with the same mechanism.
      </p>

      <h2 id="legal-basis">Legal bases</h2>
      <ul>
        <li><strong>Contract</strong> — to provide the service you signed up for, including billing and support.</li>
        <li><strong>Legitimate interests</strong> — to keep the service secure, prevent abuse, and improve reliability, balanced against your rights.</li>
        <li><strong>Consent</strong> — for marketing email and optional analytics. You can withdraw at any time.</li>
        <li><strong>Legal obligation</strong> — to retain tax records and respond to lawful requests.</li>
      </ul>

      <h2 id="sharing">Who else sees it</h2>
      <p>
        We share data with subprocessors that host and operate the service: cloud infrastructure, email delivery,
        error tracking and payment processing. The current list, regions and purposes are in the{" "}
        <Link href="/legal/dpa#subprocessors">DPA subprocessor table</Link>. Each subprocessor is bound by written
        confidentiality and data-protection terms.
      </p>
      <p>
        We may disclose data if required by law, but only after reviewing the request for validity and scope, and we
        will notify you unless prohibited. We do not sell personal data or share it for cross-context behavioural
        advertising.
      </p>

      <h2 id="transfers">International transfers</h2>
      <p>
        The hosted service runs in the EU. Support and engineering access is global, restricted to named staff, and
        logged. Transfers outside the EEA rely on the European Commission&apos;s Standard Contractual Clauses, with a
        transfer impact assessment available to customers on request. Self-hosted deployments keep all workspace
        data in your own infrastructure.
      </p>

      <h2 id="rights">Your rights</h2>
      <p>
        Subject to local law, you can access, correct, export, restrict or delete your personal data, object to
        processing based on legitimate interests, and withdraw consent. Account holders can export workspace data from
        the dashboard or API. Other requests go to <a href="mailto:legal@keel.dev">legal@keel.dev</a> and are answered
        within 30 days.
      </p>
      <p>
        If you believe we handled your data improperly you can complain to your local supervisory authority. In India,
        the Data Protection Board of India. In the EU, your national authority. We would appreciate the chance to
        resolve it first.
      </p>

      <h2 id="security">Security measures</h2>
      <p>
        Encryption in transit and at rest, least-privilege access, audit logging of administrative actions, and
        regular dependency review. The specifics are on the <Link href="/security">security page</Link>. We notify
        affected customers of confirmed personal-data breaches without undue delay and within 72 hours where the GDPR
        applies.
      </p>

      <h2 id="cookies">Cookies</h2>
      <p>
        The dashboard uses a single httpOnly session cookie. Marketing pages use no advertising cookies. Optional
        analytics, if enabled by your workspace, are aggregate and cookie-free. We do not use third-party tracking
        pixels.
      </p>

      <h2 id="changes">Changes</h2>
      <p>
        Material changes are announced by email to account owners and posted here at least 30 days before they take
        effect. The date at the top of this page is always the date of the last substantive change.
      </p>
    </LegalShell>
  );
}
