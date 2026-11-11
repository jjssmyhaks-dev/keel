export type SandboxSampleApp = {
  id: string;
  name: string;
  mark: string;
  description: string;
  action: string;
  resource: string;
  input: Record<string, unknown>;
  note: string;
};

export const SANDBOX_SAMPLE_APPS: SandboxSampleApp[] = [
  {
    id: "support-copilot",
    name: "Support copilot",
    mark: "SC",
    description: "Search a support queue for context before an agent answers a customer.",
    action: "sandbox.echo",
    resource: "queues/support",
    input: { message: "Summarize the last five tickets" },
    note: "Read actions are allowed by default in development.",
  },
  {
    id: "billing-agent",
    name: "Billing agent",
    mark: "BA",
    description: "Charge a card inside a spend cap. Financial actions require approval in production.",
    action: "sandbox.charge_card",
    resource: "acct_sandbox",
    input: { amount: 4200, currency: "usd", customer: "cus_sandbox_1" },
    note: "Set maxAmount on the grant to see an over-limit charge denied.",
  },
  {
    id: "access-reviewer",
    name: "Access reviewer",
    mark: "AR",
    description: "Grant a role after review. Admin actions are approval-gated in every environment.",
    action: "sandbox.grant_role",
    resource: "workspaces/demo",
    input: { user: "contractor@example.com", role: "admin" },
    note: "The decision and the execution are separate audit events, both tied to the approver.",
  },
  {
    id: "cleanup-bot",
    name: "Cleanup bot",
    mark: "CB",
    description: "Delete a staging workspace. Destructive actions are approval-gated in every environment.",
    action: "sandbox.delete_workspace",
    resource: "demo-staging",
    input: { workspace: "demo-staging" },
    note: "Try it against a paused agent to see the deny path.",
  },
];
