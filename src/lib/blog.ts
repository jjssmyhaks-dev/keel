export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "list"; items: string[] };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  displayDate: string;
  readMinutes: number;
  author: string;
  kicker: string;
  body: BlogBlock[];
};

export const POSTS: BlogPost[] = [
  {
    slug: "agents-need-identity-not-api-keys",
    title: "Agents need identity, not API keys",
    description: "An API key answers “is this allowed?” An identity answers “who acted, for whom, and why?” The difference is the incident report.",
    date: "2026-10-21",
    displayDate: "21 October 2026",
    readMinutes: 6,
    author: "Ashif Khan",
    kicker: "Identity",
    body: [
      {
        type: "p",
        text: "The first version of every agent integration looks the same. Someone drops a provider token into an environment variable, the agent picks it up, and the demo works. It works so well that it survives into production, where it becomes the most dangerous object in the system.",
      },
      {
        type: "p",
        text: "The problem is not that tokens are insecure. The problem is that a token is not an identity. It cannot say which program used it, which human asked for the action, what the action was supposed to accomplish, or which other actions were acceptable. It is a bearer instrument: whoever holds it can do everything it allows, and the audit trail ends at “a request with a valid token.”",
      },
      { type: "h2", text: "What a principal gives you" },
      {
        type: "p",
        text: "An agent identity is a cryptographic principal with a lifecycle. Concretely, it gives you four things a shared API key cannot:",
      },
      {
        type: "list",
        items: [
          "Attribution: every call is tied to an agent, an environment and, when relevant, the human who requested the token.",
          "Scope: the agent can reach only the actions you granted, on only the resources you named.",
          "Revocation: one agent can be stopped without rotating a secret used by five others.",
          "Proof: the identity and its permissions are part of the audit chain, so history survives a redeploy.",
        ],
      },
      {
        type: "p",
        text: "None of that requires a new model of the world. It is the same model we already use for humans — principals, roles, sessions, audit — applied to software that acts on its own. We skipped it because agents started as scripts, and scripts do not usually have opinions about money.",
      },
      { type: "h2", text: "The key never leaves the vault" },
      {
        type: "p",
        text: "A useful identity system also changes where secrets live. If the agent authenticates to Keel, the agent does not need the Slack token at all. It asks Keel to post a message, Keel evaluates the grant, decrypts the token in memory, calls Slack, and returns the result. The credential is now an implementation detail of the gateway rather than part of the agent's context window.",
      },
      {
        type: "quote",
        text: "The most secure credential is the one the agent never receives.",
      },
      {
        type: "p",
        text: "This is also a prompt-injection mitigation. Instructions smuggled into a document cannot exfiltrate a secret the agent does not have, and cannot widen a permission that is evaluated outside the model. The agent can still be manipulated into requesting the wrong action — which is why approvals exist — but the blast radius is a policy decision, not a token decision.",
      },
      { type: "h2", text: "Start with the smallest identity" },
      {
        type: "p",
        text: "You do not need to rebuild your agent runtime to get this. Register one agent, give it one read action, and route those calls through the proxy. Watch the audit events for a day. The moment you can answer “what did it do, and was it allowed?” without grepping logs across three services, the rest of the migration becomes obvious.",
      },
      {
        type: "code",
        text: `const agent = await keel.agents.create({ name: "Support Triage" });
await keel.grants.create({
  agentId: agent.id,
  credentialId: slack.id,
  actions: ["slack.list_channels"],
  resourcePattern: "*",
  purpose: "Read channel metadata to route tickets",
});`,
      },
      {
        type: "p",
        text: "The API key era taught us to rotate secrets. The agent era has to teach us something harder: to know who is acting. That is an identity problem, and it is worth solving once.",
      },
    ],
  },
  {
    slug: "approvals-as-a-primitive",
    title: "Approvals should be a first-class primitive",
    description: "Most teams wire approvals into chat and hope. A decision needs state, a signed link, an execution record and an expiry.",
    date: "2026-10-06",
    displayDate: "6 October 2026",
    readMinutes: 5,
    author: "Maya Iyer",
    kicker: "Governance",
    body: [
      {
        type: "p",
        text: "Ask a team how risky agent actions get approved and you will usually hear a variation of: “it posts in Slack and someone replies yes.” It works until the message scrolls away, the responder is on leave, or two agents ask for the same thing and nobody can tell which one ran.",
      },
      {
        type: "p",
        text: "An approval is not a message. It is a small state machine with an owner, a deadline and an execution record. Treating it as a message loses all three.",
      },
      { type: "h2", text: "What the state machine needs" },
      {
        type: "list",
        items: [
          "A frozen request: agent, connection, action, resource, risk and a redacted payload, stored at request time.",
          "A signed link that resolves to that request, not to a channel where context can change.",
          "A decider with the right role, recorded by name and timestamp, with an optional note.",
          "An expiry that closes the request if nobody acts, so a stale yes cannot execute tomorrow.",
          "An execution record showing what the provider actually returned, or why it failed.",
        ],
      },
      {
        type: "p",
        text: "Once those exist, the interesting cases become tractable. “Approve always” is a controlled grant edit, not a promise in chat. A denied request is evidence, not a deleted message. A failed execution is visible instead of silently retried.",
      },
      { type: "h2", text: "Approval is a latency budget" },
      {
        type: "p",
        text: "The objection is always speed. If every write waits for a human, the agent is useless. But approvals are not meant for every write. They are for the irreversible ones: money leaving, records deleted, public commitments made. Reversible work should run at machine speed; the skill is drawing the line correctly and making the line visible.",
      },
      {
        type: "quote",
        text: "Automate the reversible. Escalate the rest. Record both.",
      },
      {
        type: "p",
        text: "Risk defaults do most of this work. Reads and writes can flow in development; production writes ask once; destructive and financial actions always ask. A team can override any single grant when it has earned trust, and safe launch gives newly promoted agents a bounded window where non-read calls are held.",
      },
      { type: "h2", text: "Design for the agent, too" },
      {
        type: "p",
        text: "The agent side is often ignored. A good approval flow returns a machine-readable pending state with a stable id and lets the agent retry idempotently until the decision lands. It does not make the agent poll a chat channel or guess whether silence means no.",
      },
      {
        type: "code",
        text: `202 {
  "status": "pending_approval",
  "approval": { "id": "apr_8f2", "status": "pending" },
  "approvalUrl": "https://keel.dev/approve/eyJ..."
}`,
      },
      {
        type: "p",
        text: "Humans get a decision page. Agents get a contract. The same primitive serves both, and the audit trail records the handoff between them.",
      },
    ],
  },
  {
    slug: "audit-log-you-can-prove",
    title: "An audit log you can prove",
    description: "A log stored in a table you control is a story. Hash chaining turns it into evidence — as long as you verify and export it.",
    date: "2026-09-18",
    displayDate: "18 September 2026",
    readMinutes: 7,
    author: "Rohan Mehta",
    kicker: "Audit",
    body: [
      {
        type: "p",
        text: "Every system claims to have an audit log. Most of them are a table with timestamps and a delete permission. That is fine for debugging and useless for the moment an auditor or an incident reviewer asks whether the log is complete.",
      },
      {
        type: "p",
        text: "Hash chaining is a small idea with a large consequence. Each event stores the hash of the previous event and a hash of itself. Change a row in the middle and every subsequent link breaks. Delete a row and the sequence has a hole. You can detect both with a loop and a SHA-256 call.",
      },
      { type: "h2", text: "The chain is not the whole story" },
      {
        type: "p",
        text: "A chain proves internal consistency. It does not stop an operator with database access from rebuilding the entire chain from scratch. That is why verification has to leave Keel: export daily, store the last hash somewhere your application cannot write, or stream events into a write-once sink.",
      },
      {
        type: "quote",
        text: "Immutability is not a database feature. It is a property of where the evidence lives.",
      },
      {
        type: "p",
        text: "We ship three practical exits: CSV for spreadsheets and SIEM ingestion, JSONL with the hash columns intact, and signed webhooks for near-real-time delivery. Exports themselves are audited, so the act of taking evidence is part of the record.",
      },
      { type: "h2", text: "What to record, and what not to" },
      {
        type: "p",
        text: "A useful audit event answers who, what, where, outcome and why. It should include the decision source when policy denied a call, the request id that ties it to logs, and the agent or human principal behind the action. It should never include the credential.",
      },
      {
        type: "list",
        items: [
          "Record the action and the resource, not the full provider payload.",
          "Record denials. A log of successes only is a marketing document.",
          "Record token issuance and revocation — the identity lifecycle is part of the trail.",
          "Record approvals and their notes; they explain why a risky call was allowed.",
        ],
      },
      {
        type: "code",
        text: `GET /v1/audit/verify
{
  "valid": true,
  "eventsChecked": 107,
  "brokenAtSeq": null
}`,
      },
      {
        type: "p",
        text: "Run that check on a schedule. If it ever fails, you have a real incident, and you will know exactly where to start looking. That is more than most audit logs can offer.",
      },
    ],
  },
];

export function post(slug: string) {
  return POSTS.find((item) => item.slug === slug);
}
