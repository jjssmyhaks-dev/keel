"""Stdlib-only HTTP transport: retries, idempotency, timeouts and errors."""

from __future__ import annotations

import email.utils
import json
import random
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Mapping, Optional

from .errors import KeelError

DEFAULT_BASE_URL = "https://api.keel.dev/v1"
VERSION = "1.0.0"


def _is_timeout(error: BaseException) -> bool:
    return isinstance(error, (socket.timeout, TimeoutError)) or "timed out" in str(error).lower()


def _backoff(attempt: int) -> float:
    return min(0.3 * (2**attempt) + random.random() * 0.15, 5.0)


def _parse_retry_after(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    value = value.strip()
    try:
        seconds = float(value)
        if seconds >= 0:
            return min(seconds, 10.0)
    except ValueError:
        pass
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed is None:
            return None
        return min(max(parsed.timestamp() - time.time(), 0.0), 10.0)
    except (TypeError, ValueError, OverflowError):
        return None


def _query_string(query: Optional[Mapping[str, Any]]) -> str:
    if not query:
        return ""
    pairs: list[tuple[str, str]] = []
    for key, value in query.items():
        if value is None or value == "":
            continue
        if isinstance(value, bool):
            pairs.append((key, "true" if value else "false"))
        else:
            pairs.append((key, str(value)))
    return urllib.parse.urlencode(pairs)


class HttpTransport:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: Optional[str] = None,
        max_retries: int = 2,
        timeout_ms: int = 15_000,
    ) -> None:
        if not isinstance(api_key, str) or not api_key.strip():
            raise KeelError(
                "Keel requires an API key. Pass api_key with a secret key for this environment.",
                code="missing_api_key",
            )
        if api_key.strip().startswith("pk_"):
            raise KeelError(
                "The SDK requires a secret key (sk_...). Publishable keys cannot be used from the server.",
                code="publishable_key_not_allowed",
            )
        self.api_key = api_key.strip()
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.max_retries = max(0, min(int(max_retries), 5))
        self.timeout_ms = max(1_000, int(timeout_ms))

    def request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        body: Any = None,
        headers: Optional[Mapping[str, str]] = None,
        agent_token: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        retryable: bool = False,
        raw_text: bool = False,
    ) -> Any:
        url = f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        query_string = _query_string(query)
        if query_string:
            url = f"{url}?{query_string}"

        can_retry_5xx = retryable or method in ("GET", "DELETE")
        payload = None if body is None else json.dumps(body).encode("utf-8")
        attempt = 0

        while True:
            request_headers = {
                "accept": "application/json",
                "user-agent": f"keel-python/{VERSION}",
                **(headers or {}),
            }
            if payload is not None:
                request_headers["content-type"] = "application/json"
            request_headers["authorization"] = f"Bearer {agent_token or self.api_key}"
            if idempotency_key:
                request_headers["idempotency-key"] = idempotency_key

            request = urllib.request.Request(url, data=payload, headers=request_headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_ms / 1000) as response:
                    status = response.status
                    response_headers = response.headers
                    text = response.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as error:
                status = error.code
                response_headers = error.headers
                text = error.read().decode("utf-8", errors="replace")
                retryable_status = status == 429 or (status >= 500 and can_retry_5xx)
                if retryable_status and attempt < self.max_retries:
                    retry_after = _parse_retry_after(response_headers.get("retry-after") if response_headers else None)
                    time.sleep(retry_after if retry_after is not None else _backoff(attempt))
                    attempt += 1
                    continue
                raise _error_from_response(status, response_headers, text) from None
            except (urllib.error.URLError, OSError) as error:
                if attempt < self.max_retries and can_retry_5xx:
                    time.sleep(_backoff(attempt))
                    attempt += 1
                    continue
                reason = getattr(error, "reason", error)
                timed_out = _is_timeout(error) or _is_timeout(reason if isinstance(reason, BaseException) else error)
                raise KeelError(
                    (
                        f"The request to Keel timed out after {self.timeout_ms}ms ({method} {path})."
                        if timed_out
                        else f"Could not reach Keel ({method} {path}): {reason}"
                    ),
                    code="timeout" if timed_out else "network_error",
                ) from None

            if raw_text:
                if status >= 400:
                    raise _error_from_response(status, response_headers, text)
                return text

            data: Any = None
            if text:
                try:
                    data = json.loads(text)
                except json.JSONDecodeError:
                    data = None
            if status >= 400:
                raise _error_from_response(status, response_headers, text)
            if data is None:
                raise KeelError(
                    "Keel returned an empty or non-JSON response.",
                    status=status,
                    code="invalid_response",
                    request_id=_header(response_headers, "x-request-id"),
                )
            return data


def _header(headers: Any, name: str) -> Optional[str]:
    try:
        value = headers.get(name) if headers is not None else None
    except AttributeError:
        return None
    return value or None


def _error_from_response(status: int, headers: Any, text: str) -> KeelError:
    fallback_id = _header(headers, "x-request-id")
    try:
        body = json.loads(text) if text else None
    except json.JSONDecodeError:
        body = None
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        detail = body["error"]
        return KeelError(
            str(detail.get("message") or f"Keel returned HTTP {status}."),
            status=status,
            code=str(detail.get("code") or "api_error"),
            details=detail.get("details"),
            request_id=detail.get("requestId") or fallback_id,
        )
    message = text.strip()
    if len(message) >= 300:
        message = f"Keel returned HTTP {status}."
    return KeelError(
        message or f"Keel returned HTTP {status}.",
        status=status,
        code="unauthorized" if status == 401 else "api_error",
        request_id=fallback_id,
    )
