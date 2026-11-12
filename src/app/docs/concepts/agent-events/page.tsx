import type { Metadata } from "next";
import { Callout, DocsAside, DocsShell } from "@/components/docs/docs-shell";

export const metadata: Metadata = {
  title: "Agent events and data contribution",
  description: "The standard envelope behind agent decisions, policy-change capture and the data-contribution setting.",
};

export default function AgentEventsPage() {
  return (
    <DocsShell
      eyebrow="Concepts"
      title="Agent events and data contribution"
      intro="Authab records what every agent decided — allowed, approved, denied, errored or waiting for approval — plus every change to the permissions that drove the decision. The records are structured, contain no request content, and feed the learning features you can switch off at any time."
      updated="12 November 2026"
      aside={
        <DocsAside
          links={[
            { href: "#envelope", name: "Event envelope" },
            { href: "#decisions", name: "Decisions and reasons" },
            { href: "#policy", name: "Policy events" },
            { href: "#privacy", name: "Data contribution" },
            { href: "#retention", name: "Retention" },
            { href: "#failures", name: "Failure behavior" },
          ]}
        />
      }
    >
      <h2 id="envelope">Event envelope</h2>
      <p>
        Every governed call produces one <code>AgentEvent</code>. The writer accepts exactly these fields, and nothing
        else — request input, response bodies, resource names, secrets and user data are never stored:
      </p>
      <pre>{`{
  schemaVersion: 1,
  occurredAt, environmentId, organizationId, agentId, agentType,
  requestId, connectorSlug, action, riskClass, resourceType,
  decision, decisionReasonCode,
  approvalLatencyMs, upstreamStatusClass, latencyMs,
  costUnits, delegationDepth, isSandbox, contributes,
  credentialId
}`}</pre>
      <p>
        <code>credentialId</code> exists for investigation only and is excluded from every aggregate.{" "}
        <code>resourceType</code> is a connector-level label (for example <code>channel</code>), never the resource
        itself. <code>upstreamStatusClass</code> collapses the provider status to <code>2xx</code>, <code>3xx</code>,{" "}
        <code>4xx</code>, <code>5xx</code> or <code>none</code>.
      </p>

      <h2 id="decisions">Decisions and reasons</h2>
      <p>
        <code>decision</code> is one of <code>allowed</code>, <code>approved</code>, <code>denied</code>,{" "}
        <code>errored</code> or <code>pending_approval</code>. Each record carries a reason code, so a denial can be
        separated into, for example, <code>scope_not_granted</code>, <code>action_not_granted</code>,{" "}
        <code>resource_not_granted</code>, <code>condition_failed</code>, <code>grant_expired</code>,{" "}
        <code>rate_limited</code> or <code>agent_inactive</code>. Approvals add <code>approval_required</code>,{" "}
        <code>approval_approved</code>, <code>approval_denied</code> and <code>approval_expired</code>; provider
        failures record <code>provider_error</code> or <code>provider_auth_failed</code>.
      </p>
      <p>
        When a request waited for a human, <code>approvalLatencyMs</code> measures the time from the approval request
        to the decision. Sandbox calls are recorded with <code>isSandbox: true</code> so playground traffic never looks
        like production traffic.
      </p>

      <h2 id="policy">Policy events</h2>
      <p>
        A <code>PolicyEvent</code> is written next to every permission change: grant create/update/delete,
        approval-policy create/update/delete, delegation creation and just-in-time grant activation. Instead of copying
        policy text, the record stores the smallest useful summary:
      </p>
      <pre>{`{
  subject: grant | approval_policy | delegation | jit_grant,
  grantId?, approvalPolicyId?, connectorSlug?,
  actionSetJson,      // sorted action names or globs
  resourceShape,      // any | single | pattern
  approvalMode, conditionKeysJson,   // keys only, never values
  changeKind: create | update | delete,
  changedFromEventId, isSandbox, contributes
}`}</pre>
      <p>
        Updates link to the previous event for the same grant or policy through <code>changedFromEventId</code>, which
        gives an ordered history of how access changed without storing the resource names or condition values.
      </p>

      <h2 id="privacy">Data contribution</h2>
      <p>
        In <strong>Settings → Data and privacy</strong>, an organization can turn off{" "}
        <em>Contribute anonymized usage statistics</em>. The setting requires the <code>manage_security</code>{" "}
        capability, and every change inserts a <code>DataContributionChange</code> row and writes the{" "}
        <code>org.data_contribution_changed</code> audit event.
      </p>
      <p>
        Event writers copy the organization&apos;s setting into each row as <code>contributes</code> at write time.
        Turning the setting off stops future contribution immediately; it does not delete history, but aggregates
        exclude the history of organizations whose setting is currently false through a shared filter. New
        organizations start with contribution on; organizations that existed before this feature were recorded as opted
        out by the migration.
      </p>
      <Callout title="What is never included">
        Decision types, action names and counts are shared — never request or response content, resource names,
        credentials or personal data. The same guarantee applies to sandbox traffic, which is flagged so it can be
        excluded from learning.
      </Callout>

      <h2 id="retention">Retention</h2>
      <p>
        Agent events are kept for 400 days. The scheduled maintenance job deletes older rows in small batches rather
        than one long transaction, so retention never blocks the proxy path.
      </p>

      <h2 id="failures">Failure behavior</h2>
      <p>
        The revocation, agent-event and policy-event writers never throw into the caller. If a write fails, the error
        is logged and the permission change or proxy decision proceeds. Telemetry is an observability feed, not an
        authorization dependency.
      </p>
    </DocsShell>
  );
}
