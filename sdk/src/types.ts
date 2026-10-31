export type Risk = "read" | "write" | "destructive" | "financial";
export type ApprovalMode = "allow" | "require_approval" | "deny";
export type AgentStatus = "active" | "paused" | "suspended" | "revoked";

export interface List<T> {
  object: "list";
  data: T[];
}

export interface Agent {
  id: string;
  object: "agent";
  name: string;
  description: string | null;
  status: AgentStatus;
  fingerprint: string;
  publicKey: string | null;
  keyMode: "client" | "platform";
  tags: string[];
  framework: string | null;
  autonomousMode: boolean;
  safeLaunchUntil: string | null;
  ownerUserId: string | null;
  promotedFromAgentId: string | null;
  environmentId: string;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface AgentCreated extends Agent {
  privateKey?: string | null;
  warning?: string;
}

export interface AgentKey {
  id: string;
  status: string;
  createdAt: string;
  rotatedAt: string | null;
  retireAt: string | null;
}

export interface AgentGrantSummary {
  id: string;
  credentialId: string;
  connector: string;
  actions: string[];
  resourcePattern: string;
  approvalMode: ApprovalMode | null;
  expiresAt: string | null;
}

export interface AgentDetails extends Agent {
  keys?: AgentKey[];
  grants?: AgentGrantSummary[];
  approvalPolicies?: { id: string; actionPattern: string; mode: ApprovalMode }[];
}

export interface AgentToken {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  expiresAt: string;
  tokenId: string;
  scopes: string[];
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  tags?: string[];
  framework?: string;
  publicKey?: string;
  keyMode?: "client" | "platform";
  owner?: string;
  autonomousMode?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string | null;
  tags?: string[];
  framework?: string | null;
  autonomousMode?: boolean;
}

export interface TokenOptions {
  ttl?: number;
  challenge?: string;
  signature?: string;
  keyId?: string;
  privateKey?: string;
}

export interface Credential {
  id: string;
  object: "credential";
  connector: string;
  name: string;
  type: string;
  maskedHint: string;
  status: string;
  healthDetail: string | null;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  grantedAgents?: number | { id: string; name: string; status: string }[];
  lastHealth?: { result: string; detail: string | null; checkedAt: string } | null;
  health?: { result: string; detail: string | null; checkedAt: string }[];
}

export interface CredentialInput {
  connector: string;
  name?: string;
  type?: string;
  secret: string | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface CredentialUpdate {
  name?: string;
  secret?: string | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
  status?: "healthy" | "broken" | "expiring";
}

export type GrantConditionValue = string | number | boolean | string[];

export interface GrantConditions {
  timeWindowStart?: string;
  timeWindowEnd?: string;
  maxCallsPerPeriod?: number;
  periodHours?: number;
  allowedIps?: string[];
  [key: string]: GrantConditionValue | undefined;
}

export interface Grant {
  id: string;
  object: "grant";
  agentId: string;
  credentialId: string;
  actions: string[];
  resourcePattern: string;
  conditions: GrantConditions;
  approvalMode: ApprovalMode | null;
  purpose: string | null;
  expiresAt: string | null;
  createdAt: string;
  agent?: { id: string; name: string; status: string };
  credential?: { id: string; name: string; connectorSlug: string; status: string };
}

export interface CreateGrantInput {
  agentId: string;
  credentialId: string;
  actions: string[];
  resourcePattern?: string;
  conditions?: GrantConditions;
  approvalMode?: ApprovalMode | null;
  purpose?: string;
  expiresAt?: string | null;
}

export interface UpdateGrantInput {
  actions?: string[];
  resourcePattern?: string;
  conditions?: GrantConditions;
  approvalMode?: ApprovalMode | null;
  purpose?: string | null;
  expiresAt?: string | null;
}

export interface ApprovalPolicy {
  id: string;
  object: "approval_policy";
  agentId: string | null;
  actionPattern: string;
  mode: ApprovalMode;
  createdAt: string;
}

export interface PolicyInput {
  agentId?: string | null;
  actionPattern: string;
  mode: ApprovalMode;
}

export interface PolicyUpdate {
  actionPattern?: string;
  mode?: ApprovalMode;
}

export interface Approval {
  id: string;
  object: "approval";
  agentId: string;
  credentialId: string;
  grantId: string | null;
  action: string;
  summary: string;
  payload: Record<string, unknown>;
  risk: Risk;
  status: "pending" | "approved" | "denied" | "expired" | "failed";
  requestId: string;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  executionResult: unknown;
  expiresAt: string;
  createdAt: string;
  agent?: { id: string; name: string; status: string };
  credential?: { id: string; name: string; connectorSlug: string };
}

export interface ApprovalDecision {
  decision: "approve" | "deny";
  note?: string;
  approveAlways?: boolean;
}

export interface ProxyDecision {
  effect: "allow" | "deny" | "require_approval";
  risk: Risk;
  source: string;
  reason?: string;
}

export interface ProxyExecuted {
  status: "executed";
  connector: string;
  action: string;
  result: {
    status: number;
    body: unknown;
    latencyMs: number;
    mock: boolean;
  };
  decision: ProxyDecision;
  requestId: string;
}

export interface ProxyPending {
  status: "pending_approval";
  approval: Approval;
  approvalUrl: string;
  decision: ProxyDecision;
  requestId: string;
}

export type ProxyResponse = ProxyExecuted | ProxyPending;

export interface ProxyCallInput {
  connector: string;
  action: string;
  resource?: string;
  input?: Record<string, unknown>;
  credentialId?: string;
  token?: string;
  agentId?: string;
  idempotencyKey?: string;
  ttl?: number;
  privateKey?: string;
}

export interface AuditEvent {
  id: string;
  seq: number;
  timestamp: string;
  actor: { type: string; id: string | null; name: string };
  action: string;
  resource: { type: string; id: string | null };
  outcome: string;
  requestId: string | null;
  ip: string | null;
  agentId: string | null;
  payload: Record<string, unknown>;
  chain: string[];
  hash: string;
  prevHash: string;
}

export interface AuditPage {
  object: "list";
  data: AuditEvent[];
  pageInfo: { hasMore: boolean; nextCursor: number | null };
}

export interface AuditListParams {
  agent?: string;
  action?: string;
  outcome?: string;
  from?: string;
  to?: string;
  before?: number;
  limit?: number;
  order?: "asc" | "desc";
}

export interface AuditVerification {
  object: "audit_verification";
  environment: string;
  valid: boolean;
  eventsChecked: number;
  brokenAtSeq: number | null;
  verifiedAt: string;
}

export interface WebhookEndpoint {
  id: string;
  object: "webhook_endpoint";
  url: string;
  events: string[];
  status: string;
  lastDeliveryAt?: string | null;
  createdAt: string;
  secret?: string;
  warning?: string;
  deliveries?: {
    id: string;
    event: string;
    statusCode: number | null;
    attempt: number;
    deliveredAt: string | null;
    error: string | null;
    createdAt: string;
  }[];
}

export interface ConnectorAction {
  name: string;
  label: string;
  description: string;
  method: string;
  risk: Risk;
  resourceLabel: string | null;
  fields: { key: string; label: string; placeholder?: string; required?: boolean }[];
}

export interface Connector {
  object: "connector";
  slug: string;
  name: string;
  category: string;
  description: string;
  mark: string;
  color: string;
  docsUrl: string;
  status: string;
  version: string;
  authMethods: { type: string; label: string }[];
  defaultAuth: string;
  hosts: string[];
  injection: { type: "header" | "query"; name: string; prefix?: string };
  scopes: { value: string; label: string; optional?: boolean }[];
  resourceLabel: string;
  resourcePlaceholder: string;
  redactedFields: string[];
  actions: ConnectorAction[];
}

export interface ApiKeyContext {
  object: "api_key_context";
  key: {
    id: string;
    name: string;
    prefix: string;
    type: string;
    createdAt: string;
    lastUsedAt: string | null;
  } | null;
  organization: { id: string; name: string; slug: string; plan: string };
  project: { id: string; name: string };
  environment: { id: string; type: string };
}
