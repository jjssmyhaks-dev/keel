# Python SDK

Server-side Python client for [Authab](https://authab.dev/docs/sdk): agent identity, credential vault, grants, policies, approvals, proxied connector calls, audit and webhooks.

- Python 3.9+, no required dependencies (standard-library HTTP).
- Sync `Authab` and async `AsyncAuthab` with identical behaviour.
- Optional extras for Ed25519 signing, LangChain/LangGraph, CrewAI and the OpenAI Agents SDK.
- Every call uses the environment of the API key. There is no environment parameter to forget.

The SDK ships in the Authab repository. PyPI publication is pending the public launch and final package name, so install from source:

```bash
pip install "./python"
pip install "./python[signing]"        # Ed25519 client-key mode
pip install "./python[langchain]"      # LangChain + LangGraph
pip install "./python[crewai]"
pip install "./python[openai-agents]"
pip install "./python[all]"
```

From another project, use the repository URL:

```bash
pip install "authab-sdk @ git+https://github.com/jjssmyhaks-dev/keel.git#subdirectory=python"
pip install "authab-sdk[all] @ git+https://github.com/jjssmyhaks-dev/keel.git#subdirectory=python"
```

## Client

```python
import os
from authab import Authab

authab = Authab(os.environ["AUTHAB_API_KEY"], base_url="https://api.authab.dev/v1")
# or: Authab.from_env()  # AUTHAB_API_KEY, optional AUTHAB_BASE_URL

me = authab.me()
print(me["environment"]["type"], me["key"]["type"])
```

`Authab` is thread-safe; each request opens its own connection. `AsyncAuthab` runs the same calls on worker threads, so it works on every Python 3.9+ runtime without an async HTTP dependency:

```python
from authab import AsyncAuthab

authab = AsyncAuthab.from_env()
page = await authab.audit.list(limit=50)
```

## Agents and tokens

```python
agent = authab.agents.create(
    name="Atlas Research",
    description="Summarises research threads.",
    tags=["research"],
    framework="langgraph",
    key_mode="client",            # or "platform"
)
# agent["privateKey"] is present only on create, only when Authab generated it.

token = authab.agents.token(agent["id"], ttl=300)
# {"accessToken": ..., "tokenId": ..., "expiresIn": ..., "scopes": [...]}
```

Client-key agents sign a challenge. The SDK can sign it for you, or you can sign elsewhere:

```python
from authab import generate_agent_keypair, sign_challenge

keys = generate_agent_keypair()       # public_key, private_key, fingerprint
signed = sign_challenge(agent["id"], keys["private_key"])
authab.agents.token(
    agent["id"],
    challenge=signed["challenge"],
    signature=signed["signature"],
    ttl=300,
)
```

Management: `list`, `get`, `update`, `pause`, `resume`, `suspend`, `kill`, `rotate_key`, `transfer`, `preview_promotion`, `promote`.

## Vault

```python
credential = authab.vault.create(
    connector="slack",
    name="Northwind workspace",
    type="oauth",
    secret={"accessToken": os.environ["SLACK_TOKEN"]},
)

authab.vault.list(connector="slack")
authab.vault.get(credential["id"])          # metadata + maskedHint, never the secret
authab.vault.rotate(credential["id"], secret={"accessToken": next_token})
authab.vault.revoke(credential["id"])
```

## Grants, policy and approvals

```python
grant = authab.grants.create(
    agent_id=agent["id"],
    credential_id=credential["id"],
    actions=["slack.post_message"],
    resource_pattern="research-*",
    approval_mode="require_approval",
    conditions={"maxCallsPerPeriod": 40, "periodHours": 24},
    purpose="Launch briefs",
)

authab.policies.create(agent_id=agent["id"], action_pattern="stripe.*", mode="deny")

pending = authab.approvals.list(status="pending", risk="financial")
authab.approvals.approve(pending["data"][0]["id"], note="Duplicate charge confirmed.")
```

## Proxy

```python
result = authab.proxy.call(
    connector="slack",
    action="slack.post_message",
    resource="#research-launch",
    input={"channel": "#research-launch", "text": "Launch brief v3."},
    agent_id=agent["id"],          # mints and caches this agent's token
    idempotency_key="launch-v3",   # generated when omitted
)

if result["status"] == "executed":
    print(result["result"]["body"])
else:
    print(result["status"], result["approvalUrl"])
```

A pending approval is a normal return value. A policy denial raises `AuthabError` with `code="policy_denied"` and `details["decision"]`. The client retries `429` and retries `5xx`/transport failures for reads and idempotent proxy calls.

## Audit and webhooks

```python
page = authab.audit.list(agent=agent["id"], limit=50)
check = authab.audit.verify()                 # {"valid": True, "eventsChecked": ...}
csv = authab.audit.export(format="csv")       # raw text

from authab import verify_webhook

valid = verify_webhook(
    os.environ["AUTHAB_WEBHOOK_SECRET"],
    request.headers["Authab-Signature"],
    raw_body,
    tolerance_seconds=300,
)
```

## Errors

```python
from authab import AuthabError

try:
    authab.proxy.call(...)
except AuthabError as error:
    if error.code == "policy_denied":
        print(error.message, error.details)
```

Every error has `status`, `code`, `message`, `details` and `request_id`. Transport failures use `status=0` with `network_error` or `timeout`.

## Framework integrations

The adapters turn the agent's grants into one tool per granted action. Calls always go through the Authab proxy with the agent's identity; the framework never sees a provider token. Restricted grants add a required `resource` argument, and token scopes narrow the tool list.

```python
from authab import Authab
from authab.integrations.langchain import authab_langchain_tools, authab_langgraph_tool_node
from authab.integrations.crewai import authab_crewai_tools
from authab.integrations.openai_agents import authab_openai_agents_tools

authab = Authab.from_env()

langchain_tools = authab_langchain_tools(authab, "agt_atlas")
tool_node = authab_langgraph_tool_node(authab, "agt_atlas")       # add to a StateGraph as the "tools" node
crew_tools = authab_crewai_tools(authab, "agt_atlas")             # CrewAI BaseTool list
agents_sdk_tools = authab_openai_agents_tools(authab, "agt_atlas")  # FunctionTool list
```

Pass `connector="slack"` to narrow any adapter to one provider. Framework imports stay lazy, so the base SDK remains dependency-free. A pending approval comes back as a result with `status: "pending_approval"`; a denial comes back as an error payload the model can read.

For the Vercel AI SDK, use [`@authab/sdk/ai`](../sdk/README.md#vercel-ai-sdk).

## Tests

```bash
python -m unittest discover -s python/tests -v
```

The default suite runs against a local stub API server and needs no credentials or network access. The adapter suite in `tests/test_integrations_real.py` runs against the real frameworks when their extras are installed; CI installs them in the `python-frameworks` job:

```bash
pip install "./python[langchain,langgraph,crewai,openai-agents]"
python -m unittest discover -s python/tests -p "test_integrations_real.py" -v
```
