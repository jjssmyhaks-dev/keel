import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Data processing agreement",
  description: "How Keel processes workspace data on your behalf, where it is stored, and who helps us run the service.",
};

const subprocessors = [
  ["Neon", "AWS ap-southeast-1 (Singapore)", "Application hosting, managed Postgres, encrypted backups", "GDPR, SCCs"],
  ["Resend", "United States", "Transactional email — sign-in, approvals, security alerts", "SCCs"],
];

export default function DpaPage() {
  return (
    <LegalShell
      slug="dpa"
      eyebrow="DPA"
      title="Processing, on your terms."
      intro="This data processing agreement applies when Keel processes personal data on your behalf as part of the hosted service. It sits alongside the terms of service and the privacy policy, and it prevails over them for workspace data."
      updated="24 October 2026"
    >
      <h2 id="roles">1. Roles and scope</h2>
      <p>
        You are the controller and Keel is the processor for personal data contained in workspace data — for example,
        the name and email of an approver, an agent credential belonging to a named person, or personal data inside a
        proxied request. Keel is the controller for account, billing and website data, as described in the{" "}
        <Link href="/legal/privacy">privacy policy</Link>.
      </p>
      <p>
        This agreement covers the subject matter, duration, nature and purpose of processing set out in Annex 1, and
        the technical and organisational measures in Annex 2. It applies for as long as you use the hosted service.
      </p>

      <h2 id="instructions">2. Our commitments</h2>
      <ul>
        <li>We process workspace data only on your documented instructions, including this agreement and your configuration of the service.</li>
        <li>We do not sell workspace data, use it for advertising, or train models on it.</li>
        <li>We keep it confidential and restrict access to staff who need it to operate or support the service.</li>
        <li>We assist you in responding to data-subject requests and in meeting your security and breach-notification obligations.</li>
        <li>We notify you without undue delay after becoming aware of a personal-data breach, with the information you need to meet your own deadlines.</li>
        <li>At your choice and on termination, we delete or return workspace data, subject to the retention rules below.</li>
      </ul>

      <h2 id="subprocessors">3. Subprocessors</h2>
      <p>
        You authorise the subprocessors below. We impose data-protection terms no less protective than this agreement,
        remain liable for their performance, and will give at least 30 days&apos; notice before adding a subprocessor that
        handles personal data. You may object on reasonable data-protection grounds; if we cannot resolve the
        objection, you may terminate the affected service without penalty.
      </p>
      <table>
        <thead>
          <tr>
            <th>Subprocessor</th>
            <th>Location</th>
            <th>Purpose</th>
            <th>Safeguards</th>
          </tr>
        </thead>
        <tbody>
          {subprocessors.map(([name, location, purpose, safeguards]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{location}</td>
              <td>{purpose}</td>
              <td>{safeguards}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Self-hosted deployments do not use Keel subprocessors for workspace data; billing and support email still flow
        through the providers above.
      </p>

      <h2 id="transfers">4. International transfers</h2>
      <p>
        Hosted workspace data is stored in the EU. Where support or engineering access requires a transfer outside the
        EEA, we rely on the European Commission&apos;s Standard Contractual Clauses, module two, with the supplementary
        measures described in Annex 2. Transfers from India are governed by the Digital Personal Data Protection Act
        and our contractual restrictions on onward transfer.
      </p>

      <h2 id="security">5. Security measures</h2>
      <p>
        Annex 2 summarises the measures we apply: encryption in transit and at rest, envelope encryption for
        credentials, environment-scoped storage, role-based access, audit logging, least-privilege infrastructure
        access, vulnerability management and tested backups. We will not materially reduce these measures during the
        term.
      </p>

      <h2 id="audit">6. Audits</h2>
      <p>
        We will answer reasonable security questionnaires and provide our latest audit or penetration-test summary
        under NDA. If that is not sufficient, you may conduct an audit once per year with 30 days&apos; notice, remotely
        where possible, at your cost, subject to confidentiality and without access to other customers&apos; data. We
        cooperate with supervisory authorities as required.
      </p>

      <h2 id="retention">7. Retention and deletion</h2>
      <p>
        Workspace data is retained according to your plan&apos;s retention settings and deleted when you delete it. On
        termination you have 30 days to export; after that, live data is deleted within 30 days and backups are
        purged on a rolling 35-day cycle. Audit events may be retained in aggregated, non-identifying form where law
        or security requires it. Billing records are retained for seven years.
      </p>

      <h2 id="liability">8. Liability and precedence</h2>
      <p>
        Liability under this agreement is subject to the limitation of liability in the{" "}
        <Link href="/legal/terms">terms of service</Link>. If this agreement conflicts with the terms for workspace
        data, this agreement prevails. If it conflicts with a signed enterprise agreement, the enterprise agreement
        prevails.
      </p>

      <h2 id="annex1">Annex 1 — Details of processing</h2>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Subject matter</td>
            <td>Identity, credential storage, policy evaluation and auditing for AI agent calls</td>
          </tr>
          <tr>
            <td>Duration</td>
            <td>Term of the agreement, plus the retention periods above</td>
          </tr>
          <tr>
            <td>Data subjects</td>
            <td>Your personnel, approvers, and any person referenced in workspace or proxied data</td>
          </tr>
          <tr>
            <td>Data categories</td>
            <td>Account identifiers, roles, credential material, call metadata, redacted payloads, audit records</td>
          </tr>
          <tr>
            <td>Special categories</td>
            <td>None intended. You agree not to store special-category data in Keel without a separate written agreement</td>
          </tr>
          <tr>
            <td>Purpose</td>
            <td>Providing the service you configured, including enforcement, approvals and audit</td>
          </tr>
        </tbody>
      </table>

      <h2 id="annex2">Annex 2 — Technical and organisational measures</h2>
      <ul>
        <li><strong>Encryption</strong> — TLS 1.2+ in transit; AES-256-GCM at rest; envelope encryption with per-credential data keys and a deployment master key held outside the database.</li>
        <li><strong>Isolation</strong> — every record and query is scoped to one environment; development and production never share credentials, keys or audit chains.</li>
        <li><strong>Access</strong> — role-based dashboard permissions enforced server-side; named, logged and reviewed infrastructure access; no standing production database credentials for engineers.</li>
        <li><strong>Logging</strong> — hash-chained audit for workspace actions; administrative access logged and retained; secrets and payload bodies excluded from logs.</li>
        <li><strong>Resilience</strong> — encrypted backups, restore tests, documented incident response, and a post-incident review for every Sev-1.</li>
        <li><strong>Vendors</strong> — written data-protection terms, annual review, and prompt removal of subprocessors that fail our standards.</li>
      </ul>

      <h2 id="sign">9. Signing</h2>
      <p>
        Enterprise customers can execute this DPA through their order form. For everyone else, accepting the terms of
        service and using the hosted service constitutes acceptance of this agreement. Need a countersigned copy or a
        specific jurisdiction&apos;s template? Write to <a href="mailto:legal@keel.dev">legal@keel.dev</a>.
      </p>
    </LegalShell>
  );
}
