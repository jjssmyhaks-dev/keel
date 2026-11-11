"""Type aliases for the shapes the Authab API returns.

These are TypedDicts, so they are plain dicts at runtime and cost nothing to
import. They exist for editor autocomplete and static checkers.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict

Risk = Literal["read", "write", "destructive", "financial", "admin"]
ApprovalMode = Literal["allow", "require_approval", "deny"]
AgentStatus = Literal["active", "paused", "suspended", "revoked"]


class ListObject(TypedDict):
    object: Literal["list"]
    data: list[dict[str, Any]]


class ApiKeyContext(TypedDict):
    object: Literal["api_key_context"]
    key: Optional[dict[str, Any]]
    organization: dict[str, Any]
    project: dict[str, Any]
    environment: dict[str, Any]


class Agent(TypedDict, total=False):
    id: str
    object: Literal["agent"]
    name: str
    description: Optional[str]
    status: AgentStatus
    fingerprint: str
    publicKey: Optional[str]
    keyMode: Literal["client", "platform"]
    tags: list[str]
    framework: Optional[str]
    autonomousMode: bool
    safeLaunchUntil: Optional[str]
    ownerUserId: Optional[str]
    environmentId: str
    lastActiveAt: Optional[str]
    createdAt: str


class AgentToken(TypedDict):
    accessToken: str
    tokenType: Literal["Bearer"]
    expiresIn: int
    expiresAt: str
    tokenId: str
    scopes: list[str]


class Grant(TypedDict, total=False):
    id: str
    object: Literal["grant"]
    agentId: str
    credentialId: str
    actions: list[str]
    resourcePattern: str
    conditions: dict[str, Any]
    approvalMode: Optional[ApprovalMode]
    purpose: Optional[str]
    expiresAt: Optional[str]
    createdAt: str
    agent: dict[str, Any]
    credential: dict[str, Any]


class Approval(TypedDict, total=False):
    id: str
    object: Literal["approval"]
    agentId: str
    credentialId: str
    grantId: Optional[str]
    action: str
    summary: str
    payload: dict[str, Any]
    risk: Risk
    status: Literal["pending", "approved", "denied", "expired", "failed"]
    requestId: str
    decisionNote: Optional[str]
    decidedBy: Optional[str]
    decidedAt: Optional[str]
    executionResult: Any
    expiresAt: str
    createdAt: str
    approvalUrl: str


class ProxyExecuted(TypedDict):
    status: Literal["executed"]
    connector: str
    action: str
    result: dict[str, Any]
    decision: dict[str, Any]
    requestId: str


class ProxyPending(TypedDict):
    status: Literal["pending_approval"]
    approval: Approval
    approvalUrl: str
    decision: dict[str, Any]
    requestId: str


ProxyResponse = ProxyExecuted | ProxyPending


class ConnectorAction(TypedDict, total=False):
    name: str
    label: str
    description: str
    method: str
    risk: Risk
    resourceLabel: Optional[str]
    fields: list[dict[str, Any]]


class Connector(TypedDict, total=False):
    object: Literal["connector"]
    slug: str
    name: str
    category: str
    description: str
    status: str
    version: str
    authMethods: list[dict[str, Any]]
    defaultAuth: str
    hosts: list[str]
    scopes: list[dict[str, Any]]
    resourceLabel: str
    resourcePlaceholder: str
    redactedFields: list[str]
    actions: list[ConnectorAction]


class AuditEvent(TypedDict, total=False):
    id: str
    seq: int
    timestamp: str
    actor: dict[str, Any]
    action: str
    resource: dict[str, Any]
    outcome: str
    requestId: Optional[str]
    ip: Optional[str]
    agentId: Optional[str]
    payload: dict[str, Any]
    hash: str
    prevHash: str


class AuditPage(TypedDict):
    object: Literal["list"]
    data: list[AuditEvent]
    pageInfo: dict[str, Any]


class Credential(TypedDict, total=False):
    id: str
    object: Literal["credential"]
    connector: str
    name: str
    type: str
    maskedHint: str
    status: str
    healthDetail: Optional[str]
    metadata: dict[str, Any]
    expiresAt: Optional[str]
    lastUsedAt: Optional[str]
    revokedAt: Optional[str]
    createdAt: str


class WebhookEndpoint(TypedDict, total=False):
    id: str
    object: Literal["webhook_endpoint"]
    url: str
    events: list[str]
    status: str
    secret: Optional[str]
    createdAt: str
