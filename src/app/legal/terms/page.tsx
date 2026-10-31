import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/legal/legal-shell";

export const metadata: Metadata = {
  title: "Terms — Keel",
  description: "The agreement that governs your use of Keel, the hosted service and self-hosted deployments.",
};

export default function TermsPage() {
  return (
    <LegalShell
      slug="terms"
      eyebrow="Terms"
      title="The terms of the deal."
      intro="These terms govern your use of Keel. They are written to be read by engineers as well as lawyers, and they describe what we provide, what we expect from you, and what happens when something goes wrong."
      updated="24 October 2026"
    >
      <h2 id="agreement">1. The agreement</h2>
      <p>
        This agreement is between Keel Systems Pvt Ltd (&ldquo;Keel&rdquo;, &ldquo;we&rdquo;) and the organisation or individual that creates a
        workspace (&ldquo;you&rdquo;). By creating a workspace, using the API, or deploying the software, you accept it. If you accept
        on behalf of an organisation, you confirm you are authorised to bind it.
      </p>
      <p>
        If you have a signed enterprise agreement with Keel, that agreement prevails over these terms where they
        conflict. The <Link href="/legal/dpa">data processing agreement</Link> forms part of this agreement.
      </p>

      <h2 id="service">2. What we provide</h2>
      <p>
        Keel is an identity, credential vault and governance layer for AI agents. The hosted service includes the
        dashboard, API, agent proxy, approval workflow and audit trail. Self-hosted deployments are licensed under the
        terms distributed with the software.
      </p>
      <p>
        We will provide the service with reasonable skill and care, maintain it as described on the{" "}
        <Link href="/status">status page</Link>, and give at least 30 days&apos; notice before removing a generally
        available feature. We may add features, and some may be gated by plan.
      </p>

      <h2 id="accounts">3. Accounts and security</h2>
      <ul>
        <li>You are responsible for the accuracy of account information and for keeping credentials confidential.</li>
        <li>You must notify us promptly at <a href="mailto:security@keel.dev">security@keel.dev</a> if you suspect unauthorised access.</li>
        <li>Workspace administrators control member access. You are responsible for the actions of members and agents you authorise.</li>
        <li>Production writes require a verified email and an owner or admin role. Do not attempt to bypass these controls.</li>
      </ul>

      <h2 id="acceptable-use">4. Acceptable use</h2>
      <p>You may not use Keel to:</p>
      <ul>
        <li>Violate law, infringe rights, or facilitate fraud, harassment or the distribution of malware.</li>
        <li>Access systems you are not authorised to access, including by using the proxy to reach third-party services without permission.</li>
        <li>Circumvent rate limits, approval requirements or tenant isolation, or probe other customers&apos; data.</li>
        <li>Resell the hosted service as a standalone identity product without a written reseller agreement.</li>
        <li>Reverse engineer non-open-source components except as permitted by law.</li>
      </ul>
      <p>
        You are responsible for the actions your agents take at connected providers, and for having the right to use
        every credential you store.
      </p>

      <h2 id="plans">5. Plans, billing and overage</h2>
      <p>
        Plans, included call volumes and overage rates are described on the{" "}
        <Link href="/pricing">pricing page</Link>, which forms part of these terms. Fees are billed in advance
        monthly or annually. Indian customers are billed in INR through Razorpay with GST; other customers in USD
        through Stripe.
      </p>
      <ul>
        <li>Overage is metered per proxied call and invoiced at the end of the billing period.</li>
        <li>Fees are non-refundable except where required by law or where we terminate for our convenience.</li>
        <li>We may change prices with 30 days&apos; notice; changes apply at your next renewal.</li>
        <li>Late payment may result in suspension after notice. You remain liable for fees accrued before suspension.</li>
      </ul>

      <h2 id="free">6. Free and development use</h2>
      <p>
        The Free plan is a development environment. Production promotion requires a paid plan. We may impose
        reasonable usage limits on Free workspaces to protect the service, and we may suspend Free workspaces that are
        inactive for 12 months after notice.
      </p>

      <h2 id="data">7. Your data</h2>
      <p>
        You retain all rights to the data you put into Keel: configuration, credentials (in encrypted form), call
        records and audit events. You grant us a licence to process that data solely to provide the service, as
        described in the <Link href="/legal/privacy">privacy policy</Link> and the{" "}
        <Link href="/legal/dpa">DPA</Link>.
      </p>
      <p>
        On termination you may export your data for 30 days, after which it is deleted from live systems and then
        from backups on the schedule in the DPA. Audit records required for legal or security purposes may be retained
        longer in aggregated form.
      </p>

      <h2 id="ip">8. Intellectual property</h2>
      <p>
        Keel and its licensors own the service, documentation and branding. You own your data and any applications you
        build. Feedback you send us may be used to improve the product without obligation, but we will not publish it
        attributed to you without permission.
      </p>

      <h2 id="availability">9. Availability and support</h2>
      <p>
        The hosted service targets 99.9% monthly availability, excluding scheduled maintenance announced in advance.
        Enterprise plans may include a service credit schedule in their order form. Support response targets are
        published on the <Link href="/contact">contact page</Link> and are targets, not guarantees, unless a signed
        agreement says otherwise.
      </p>

      <h2 id="warranty">10. Warranties and disclaimers</h2>
      <p>
        We warrant that the service will operate materially as documented. Except for that warranty and anything that
        cannot be excluded by law, the service is provided &ldquo;as is&rdquo;. We do not warrant that agents will never make a
        mistake, that a connected provider will behave as documented, or that policy configuration will match your
        intent — that is why approvals and audit exist.
      </p>
      <p>
        Keel is a control plane, not an insurer. You remain responsible for the business consequences of calls your
        agents are authorised to make.
      </p>

      <h2 id="liability">11. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, neither party is liable for indirect, incidental, special or
        consequential damages, or for lost profits or revenue. Our aggregate liability arising from this agreement is
        limited to the fees you paid in the 12 months before the claim, or 100 USD if you are on a free plan.
      </p>
      <p>
        These limits do not apply to fraud, wilful misconduct, breach of confidentiality, or your obligation to pay
        fees, and nothing excludes liability that cannot be excluded by law — including, where applicable, for death
        or personal injury.
      </p>

      <h2 id="term">12. Term and termination</h2>
      <p>
        You may cancel at any time from the dashboard; cancellation takes effect at the end of the current billing
        period. We may suspend or terminate immediately for material breach, non-payment after notice, unlawful use,
        or risk to the service or other customers. Either party may terminate for convenience with 30 days&apos; notice.
      </p>
      <p>
        On termination, production calls stop and the workspace becomes read-only during the export window.
        Sections that by their nature survive — payment, confidentiality, intellectual property, liability and
        governing law — survive termination.
      </p>

      <h2 id="confidentiality">13. Confidentiality</h2>
      <p>
        Each party will protect the other&apos;s confidential information with at least reasonable care and use it only to
        perform under this agreement. This does not apply to information that is public, independently developed, or
        required to be disclosed by law, provided the disclosing party is notified where lawful.
      </p>

      <h2 id="changes">14. Changes to these terms</h2>
      <p>
        We may update these terms. Material changes are announced to workspace owners by email at least 30 days before
        they take effect. Continued use after the effective date accepts the updated terms; if you do not agree, you
        may cancel before that date.
      </p>

      <h2 id="law">15. Governing law</h2>
      <p>
        These terms are governed by the laws of India. The courts of Bengaluru have exclusive jurisdiction, except
        that either party may seek injunctive relief in any competent court. For customers in the EU, nothing in this
        clause removes mandatory consumer protections you are entitled to.
      </p>

      <h2 id="contact">16. Contact</h2>
      <p>
        Questions about these terms: <a href="mailto:legal@keel.dev">legal@keel.dev</a>. Security reports:{" "}
        <a href="mailto:security@keel.dev">security@keel.dev</a>. Billing: <a href="mailto:billing@keel.dev">billing@keel.dev</a>.
      </p>
    </LegalShell>
  );
}
