from __future__ import annotations

import asyncio
import base64
import json
import sys
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from keel import AsyncKeel, Keel, KeelError, generate_agent_keypair, sign_challenge, verify_webhook


class FakeApp:
    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.responder = lambda method, path, headers, body: (200, {}, {})

    def respond(self, method, path, headers, body):
        headers = {key.lower(): value for key, value in headers.items()}
        self.requests.append({"method": method, "path": path, "headers": headers, "body": body})
        return self.responder(method, path, headers, body)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _serve(self) -> None:
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else ""
        status, headers, payload = self.server.app.respond(self.command, self.path, dict(self.headers), body)
        data = (payload if isinstance(payload, str) else json.dumps(payload)).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", headers.get("content-type", "application/json"))
        for key, value in headers.items():
            if key.lower() != "content-type":
                self.send_header(key, value)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _serve
    do_POST = _serve
    do_PATCH = _serve
    do_DELETE = _serve

    def log_message(self, *args) -> None:
        pass


class ApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.app = FakeApp()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.app = self.app
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def client(self, **options) -> Keel:
        options.setdefault("max_retries", 0)
        options.setdefault("timeout_ms", 5000)
        return Keel("sk_test_123", base_url=self.base_url, **options)


class TransportTests(ApiTestCase):
    def test_requires_a_secret_key(self):
        with self.assertRaises(KeelError) as missing:
            Keel("")
        self.assertEqual(missing.exception.code, "missing_api_key")
        with self.assertRaises(KeelError) as publishable:
            Keel("pk_live_123")
        self.assertEqual(publishable.exception.code, "publishable_key_not_allowed")

    def test_sends_auth_query_and_json(self):
        self.app.responder = lambda method, path, headers, body: (
            200,
            {},
            {"object": "list", "data": []},
        )
        result = self.client().agents.list(status="active", limit=5)
        self.assertEqual(result["data"], [])
        request = self.app.requests[0]
        self.assertEqual(request["method"], "GET")
        self.assertEqual(request["path"], "/v1/agents?status=active&limit=5")
        self.assertEqual(request["headers"]["authorization"], "Bearer sk_test_123")
        self.assertIn("keel-python/1.0.0", request["headers"]["user-agent"])

    def test_snake_case_input_maps_to_api_fields(self):
        self.app.responder = lambda method, path, headers, body: (200, {}, {"id": "agt_1"})
        self.client().agents.create(
            "Atlas",
            description=None,
            tags=["research"],
            autonomous_mode=True,
        )
        request = self.app.requests[0]
        payload = json.loads(request["body"])
        self.assertEqual(request["path"], "/v1/agents")
        self.assertEqual(payload["name"], "Atlas")
        self.assertNotIn("description", payload)
        self.assertEqual(payload["tags"], ["research"])
        self.assertTrue(payload["autonomousMode"])
        self.assertNotIn("framework", payload)

    def test_error_response_becomes_keel_error(self):
        self.app.responder = lambda method, path, headers, body: (
            403,
            {"x-request-id": "req_123"},
            {
                "error": {
                    "code": "policy_denied",
                    "message": "Nope.",
                    "details": {"source": "grant.missing"},
                    "requestId": "req_123",
                }
            },
        )
        with self.assertRaises(KeelError) as caught:
            self.client().agents.get("agt_1")
        error = caught.exception
        self.assertEqual(error.status, 403)
        self.assertEqual(error.code, "policy_denied")
        self.assertEqual(error.message, "Nope.")
        self.assertEqual(error.details, {"source": "grant.missing"})
        self.assertEqual(error.request_id, "req_123")
        self.assertIn("policy_denied (403)", str(error))

    def test_retries_safe_methods_on_server_errors(self):
        self.app.responder = self._sequence(
            [(500, {}, {"error": {"code": "boom", "message": "down"}}), (200, {}, {"ok": True})]
        )
        result = self.client(max_retries=2).me()
        self.assertTrue(result["ok"])
        self.assertEqual(len(self.app.requests), 2)

    def test_does_not_retry_unsafe_posts(self):
        self.app.responder = lambda method, path, headers, body: (
            500,
            {},
            {"error": {"code": "boom", "message": "down"}},
        )
        with self.assertRaises(KeelError):
            self.client(max_retries=2).agents.create("Atlas")
        self.assertEqual(len(self.app.requests), 1)

    def test_honours_retry_after(self):
        self.app.responder = self._sequence(
            [(429, {"retry-after": "0"}, {"error": {"code": "rate_limited", "message": "slow down"}}), (200, {}, {})]
        )
        self.client(max_retries=1).me()
        self.assertEqual(len(self.app.requests), 2)

    def test_raw_export_returns_text(self):
        self.app.responder = lambda method, path, headers, body: (200, {"content-type": "text/csv"}, "seq,action\n1,proxy.call\n")
        text = self.client().audit.export(format="csv")
        self.assertTrue(text.startswith("seq,action"))
        self.assertIn("/audit/export?format=csv", self.app.requests[0]["path"])

    def test_async_client_works(self):
        self.app.responder = lambda method, path, headers, body: (200, {}, {"object": "api_key_context"})
        client = AsyncKeel("sk_test_123", base_url=self.base_url)
        self.assertEqual(asyncio.run(client.me())["object"], "api_key_context")

    @staticmethod
    def _sequence(responses):
        queue = list(responses)

        def respond(method, path, headers, body):
            return queue.pop(0) if len(queue) > 1 else queue[0]

        return respond


class ProxyTests(ApiTestCase):
    def test_executed_call_uses_agent_token_and_idempotency(self):
        self.app.responder = lambda method, path, headers, body: (
            200,
            {},
            {"status": "executed", "action": "slack.post_message"},
        )
        result = self.client().proxy.call(
            action="slack.post_message",
            input={"channel": "#eng", "text": "hi"},
            token="tok_agent",
            idempotency_key="fixed-key",
        )
        self.assertEqual(result["status"], "executed")
        request = self.app.requests[0]
        self.assertEqual(request["path"], "/v1/proxy/slack")
        self.assertEqual(request["headers"]["authorization"], "Bearer tok_agent")
        self.assertEqual(request["headers"]["idempotency-key"], "fixed-key")
        payload = json.loads(request["body"])
        self.assertEqual(payload["action"], "slack.post_message")
        self.assertEqual(payload["input"], {"channel": "#eng", "text": "hi"})
        self.assertNotIn("credentialId", payload)

    def test_mints_and_caches_an_agent_token(self):
        expires = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")

        def responder(method, path, headers, body):
            if path.endswith("/token"):
                return 200, {}, {"accessToken": "tok_minted", "tokenType": "Bearer", "expiresAt": expires}
            return 200, {}, {"status": "executed"}

        self.app.responder = responder
        client = self.client()
        client.proxy.call(action="slack.post_message", input={"text": "one"}, agent_id="agt_1")
        client.proxy.call(action="slack.post_message", input={"text": "two"}, agent_id="agt_1")
        token_requests = [request for request in self.app.requests if request["path"].endswith("/token")]
        self.assertEqual(len(token_requests), 1)
        proxy_requests = [request for request in self.app.requests if "/proxy/" in request["path"]]
        self.assertEqual(proxy_requests[0]["headers"]["authorization"], "Bearer tok_minted")
        self.assertTrue(proxy_requests[0]["headers"]["idempotency-key"].startswith("sdk_"))

    def test_pending_approval_is_returned_not_raised(self):
        self.app.responder = lambda method, path, headers, body: (
            202,
            {},
            {
                "status": "pending_approval",
                "approval": {"id": "apr_1", "status": "pending"},
                "approvalUrl": "https://keel.dev/approvals/apr_1",
            },
        )
        result = self.client().proxy.call(action="stripe.refund", input={}, token="tok")
        self.assertEqual(result["status"], "pending_approval")
        self.assertEqual(result["approval"]["id"], "apr_1")

    def test_requires_token_or_agent_id(self):
        with self.assertRaises(ValueError):
            self.client().proxy.call(action="slack.post_message")

    def test_missing_cryptography_is_reported_for_client_keys(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            with self.assertRaises(KeelError) as caught:
                sign_challenge("agt_1", "not-a-key")
            self.assertEqual(caught.exception.code, "signing_dependency_missing")


class SigningTests(unittest.TestCase):
    def test_generate_keypair_and_sign_challenge(self):
        try:
            from cryptography.hazmat.primitives import serialization
        except ImportError:
            self.skipTest("cryptography is not installed")

        pair = generate_agent_keypair()
        self.assertTrue(pair["public_key"].startswith("-----BEGIN PUBLIC KEY-----"))
        self.assertEqual(len(pair["fingerprint"]), 64)
        signed = sign_challenge("agt_1", pair["private_key"])
        self.assertRegex(signed["challenge"], r"^\d+\.[0-9a-f-]{36}$")
        public_key = serialization.load_pem_public_key(pair["public_key"].encode())
        public_key.verify(
            base64.b64decode(signed["signature"]),
            f"agt_1.{signed['challenge']}".encode(),
        )

    def test_signed_token_request(self):
        try:
            from cryptography.hazmat.primitives import serialization
        except ImportError:
            self.skipTest("cryptography is not installed")

        pair = generate_agent_keypair()
        app = FakeApp()
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def responder(method, path, headers, body):
                return 200, {}, {"accessToken": "tok", "expiresAt": "2099-01-01T00:00:00Z"}

            app.responder = responder
            client = Keel("sk_test", base_url=f"http://127.0.0.1:{server.server_address[1]}/v1")
            client.agents.token("agt_1", private_key=pair["private_key"], ttl=120)
            payload = json.loads(app.requests[0]["body"])
            self.assertEqual(payload["ttl"], 120)
            self.assertIn("challenge", payload)
            self.assertIn("signature", payload)

            serialization.load_pem_public_key(pair["public_key"].encode()).verify(
                base64.b64decode(payload["signature"]),
                f"agt_1.{payload['challenge']}".encode(),
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


class WebhookTests(unittest.TestCase):
    def test_accepts_a_fresh_signature(self):
        import hashlib
        import hmac

        secret = "whsec_test"
        body = '{"id":"evt_1"}'
        timestamp = 1_790_000_000
        signature = hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
        self.assertTrue(
            verify_webhook(secret, f"t={timestamp},v1={signature}", body, now=timestamp)
        )

    def test_rejects_tampering_and_staleness(self):
        import hashlib
        import hmac

        secret = "whsec_test"
        body = '{"id":"evt_1"}'
        timestamp = 1_790_000_000
        signature = hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256).hexdigest()
        self.assertFalse(verify_webhook(secret, f"t={timestamp},v1={signature}", body + " ", now=timestamp))
        self.assertFalse(verify_webhook(secret, f"t={timestamp},v1={signature}", body, now=timestamp + 301))


if __name__ == "__main__":
    unittest.main()
