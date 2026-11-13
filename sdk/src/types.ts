export type Risk = "read" | "write" | "destructive" | "financial" | "admin";
export type ApprovalMode = "allow" | "require_approval" | "deny";
export type AgentStatus = "active" | "paused" | "suspended" | "revoked";
export type AgentType =
  | "support"
  | "sales"
  | "finance"
  | "coding"
  | "research"
  | "operations"
  | "data"
  | "other";
export type VerificationVisibility = "public" | "limited" | "private";

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
  type: AgentType;
  verificationVisibility: VerificationVisibility;
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
  type?: AgentType;
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
  type?: AgentType;
  verificationVisibility?: VerificationVisibility;
  autonomousMode?: boolean;
}

export interface AgentIdentityDocument {
  agentId: string;
  docSeq: number;
  document: {
    v: number;
    iss: string;
    iat: number;
    doc_seq: number;
    agent_id: string;
    key_fingerprint: string;
    public_jwk: { kty: "OKP"; crv: "Ed25519"; x: string };
    org_ref: string;
    environment: "development" | "production";
    status: AgentStatus;
    visibility: VerificationVisibility;
    created_at: string;
  };
  jws: string;
  issuerKeyId: string;
  issuedAt: string;
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
    truncated: boolean;
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
  source?: "builtin" | "custom";
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

export interface ConnectorSummary {
  slug: string;
  name: string;
  category: string;
  version: string;
  actions: number;
  auth: string;
}

export interface ConnectorList extends List<Connector> {
  builtin: ConnectorSummary[];
  custom: CustomConnector[];
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

export interface PolicyTraceStep {
  check: string;
  outcome: "pass" | "fail" | "skip";
  detail: string;
}

export interface PolicySimulationInput {
  agentId: string;
  credentialId: string;
  action: string;
  resource?: string;
  input?: Record<string, unknown>;
  ip?: string;
  now?: string;
}

export interface PolicySimulation {
  object: "policy_simulation";
  simulated: true;
  evaluatedAt: string;
  decision: {
    effect: "allow" | "deny" | "require_approval";
    reason: string;
    risk: Risk;
    source: string;
    wouldExecute: boolean;
    wouldRequestApproval: boolean;
  };
  action: { name: string; label: string; risk: Risk } | null;
  grant: Grant | null;
  trace: PolicyTraceStep[];
  requestId: string;
}

export interface GrantRequestInput {
  credentialId?: string;
  connector?: string;
  actions: string[];
  resourcePattern?: string;
  reason: string;
  durationMinutes?: number;
}

export interface GrantRequest {
  object: "grant_request";
  status: "pending_approval";
  approvalId: string;
  grantId: string;
  approvalUrl: string;
  expiresAt: string;
  note: string;
  requestId: string;
}

export interface ClientSecret {
  id: string;
  object: "client_secret";
  agentId: string;
  label: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ClientSecretCreated extends ClientSecret {
  secret: string;
  warning: string;
}

export interface CreateClientSecretInput {
  label?: string;
  scopes?: string[];
  expiresInDays?: number;
}

export interface WorkloadIdentity {
  id: string;
  object: "workload_identity";
  name: string;
  type: string;
  issuer: string;
  audience: string;
  jwksUrl: string | null;
  jwks: Record<string, unknown> | null;
  agentId: string;
  agentName?: string | null;
  subjectPattern: string | null;
  requiredClaims: Record<string, unknown>;
  tokenTtlSeconds: number;
  enabled: boolean;
  createdAt: string;
}

export interface CreateWorkloadIdentityInput {
  name: string;
  type?: "spiffe" | "kubernetes" | "oidc";
  issuer: string;
  audience: string;
  agentId: string;
  jwksUrl?: string;
  jwks?: Record<string, unknown>;
  subjectPattern?: string;
  requiredClaims?: Record<string, unknown>;
  tokenTtlSeconds?: number;
  enabled?: boolean;
}

export interface ClientCredentialsInput {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  ttl?: number;
  dpopProof?: string;
}

export interface TokenExchangeInput {
  subjectToken: string;
  agentId?: string;
  scopes?: string[];
  ttl?: number;
  dpopProof?: string;
}

export interface WorkloadExchangeInput {
  token: string;
  scopes?: string[];
  ttl?: number;
  dpopProof?: string;
}

export interface TokenGrant {
  access_token: string;
  issued_token_type: string;
  token_type: "Bearer" | "DPoP";
  expires_in: number;
  scope: string;
  token_id: string;
  agent: { id: string; name: string };
  parent_token_id?: string;
  act?: Record<string, unknown>;
  workload_identity?: { id: string; name: string; issuer: string };
}

export interface CustomConnectorAction {
  name: string;
  label: string;
  description: string;
  method: string;
  path: string;
  risk: Risk;
  resourceLabel: string | null;
  queryFields: string[];
  fields: { key: string; label: string; type?: string; required?: boolean; placeholder?: string }[];
}

export interface CustomConnector {
  id: string;
  object: "custom_connector";
  slug: string;
  name: string;
  description: string | null;
  category: string;
  version: number;
  specVersion: string;
  status: string;
  archivedAt: string | null;
  hosts: string[];
  auth: { type: string; methods: { type: string; label: string }[] };
  credentialFields: { key: string; label: string; secret: boolean; required: boolean }[];
  actions: CustomConnectorAction[];
  healthCheck: { action: string; intervalMinutes?: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomConnectorDetails extends CustomConnector {
  versions: { version: number; specVersion: string; createdAt: string }[];
}

export interface CustomConnectorList extends List<CustomConnector> {
  builtin: ConnectorSummary[];
}

export interface ImportConnectorInput {
  spec: string;
  slug?: string;
  name?: string;
  category?: string;
  color?: string;
  mark?: string;
  baseUrl?: string;
  authScheme?: string;
}

export interface ImportConnectorResult {
  object: "custom_connector" | "custom_connector_unchanged";
  unchanged: boolean;
  version: number;
  warnings: string[];
  connector: CustomConnector;
}

export interface RollbackConnectorResult {
  object: "custom_connector";
  unchanged: boolean;
  version: number;
  connector: CustomConnector;
}

export interface ConfigFileAgent {
  name: string;
  type?: string;
  description?: string | null;
  tags?: string[];
  autonomousMode?: boolean;
}

export interface ConfigFileConnection {
  name: string;
  connector: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfigFileGrant {
  agent: string;
  connection: string;
  actions: string[];
  resource?: string;
  approvalMode?: ApprovalMode | null;
  conditions?: GrantConditions;
  expiresAt?: string | null;
}

export interface ConfigFileApprovalPolicy {
  agent: string | null;
  actionPattern: string;
  mode: ApprovalMode;
  slaMinutes?: number | null;
  escalateToRole?: string | null;
}

export interface ConfigFileWebhook {
  url: string;
  events: string[];
}

export interface ConfigFile {
  version: 1;
  environment: string;
  agents: ConfigFileAgent[];
  connections: ConfigFileConnection[];
  grants: ConfigFileGrant[];
  approvalPolicies: ConfigFileApprovalPolicy[];
  webhooks: ConfigFileWebhook[];
}

export interface ConfigApplyInput {
  config?: ConfigFile;
  yaml?: string;
  dryRun?: boolean;
  prune?: boolean;
  /** Sends x-authab-confirm: prune. Required for production prune. */
  confirmPrune?: boolean;
}

export interface ConfigApplyChange {
  key: string;
  changes: string[];
}

export interface ConfigApplyResult {
  version: 1;
  environment: string;
  dryRun: boolean;
  create: string[];
  update: ConfigApplyChange[];
  delete: string[];
  warnings: string[];
  results?: {
    created: string[];
    updated: string[];
    deleted: string[];
    agents: { name: string; id: string; privateKey: string | null }[];
    webhookSecrets: { url: string; secret: string }[];
  };
}

export interface ConsentRequestInput {
  agentId: string;
  redirectUri: string;
  endUser: { externalUserId: string; email?: string | null };
  scopes?: string[];
  connectors?: string[];
  state?: string;
  expiresInMinutes?: number;
  durationOptions?: ConsentDuration[];
}

export type ConsentDuration = "session" | "30d" | "until_revoked";

export interface ConsentRequestCreated {
  id: string;
  url: string;
  expiresAt: string;
}

export interface ConsentSummary {
  id: string;
  agentId: string;
  agentName: string | null;
  endUserId: string;
  scopes: string[];
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface ConsentTokenGrant {
  agentToken: string;
  expiresIn: number;
  consentId: string;
  endUserId: string;
  scopes: string[];
  expiresAt?: string | null;
}

export interface DataRequestSummary {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface EndUserConnection {
  id: string;
  name: string;
  connector: string;
  type: string;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface EndUserSummary {
  id: string;
  externalUserId: string;
  email: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  consents: ConsentSummary[];
  dataRequests: DataRequestSummary[];
}

export interface EndUserDetails extends EndUserSummary {
  connections: EndUserConnection[];
}

export interface ControlLink {
  url: string;
  expiresAt: string;
}

export type TrustStatus = "invited" | "active" | "declined" | "revoked";

export interface TrustInviteInput {
  externalAgentId: string;
  note?: string;
  maxScopes?: string[];
}

export interface TrustRelationship {
  id: string;
  status: TrustStatus;
  note: string | null;
  maxScopes: string[];
  ownerEnvironmentId: string;
  externalEnvironmentId: string;
  shadowAgentId: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  externalAgent: { id: string; name: string; status: string; orgName: string | null } | null;
  shadowAgent: { id: string; name: string; status: string } | null;
}

export interface TrustExchangeInput {
  trustRelationshipId: string;
  scopes?: string[];
  ttl?: number;
}

export interface TrustTokenGrant {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  expires_at: string;
  token_id: string;
  scope: string;
  scopes: string[];
  trust: string;
  x_org: true;
  agent: { id: string; name: string; environmentId: string };
}
