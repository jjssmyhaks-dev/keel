"""Ed25519 challenge signing for client-key-mode agents."""

from __future__ import annotations

import base64
import hashlib
import time
import uuid
from typing import Optional

from .errors import KeelError


def _normalize_pem(value: str) -> str:
    trimmed = value.strip()
    if "BEGIN" in trimmed:
        return trimmed + ("\n" if not trimmed.endswith("\n") else "")
    compact = "".join(trimmed.split())
    lines = [compact[index : index + 64] for index in range(0, len(compact), 64)]
    return "-----BEGIN PRIVATE KEY-----\n" + "\n".join(lines) + "\n-----END PRIVATE KEY-----\n"


def _require_cryptography():
    try:
        from cryptography.hazmat.primitives import serialization
    except ImportError:
        raise KeelError(
            "Client-key signing needs the cryptography package. Install keel-sdk[signing], "
            "or use a platform-key-mode agent.",
            code="signing_dependency_missing",
        ) from None
    return serialization


def sign_challenge(agent_id: str, private_key_pem: str, challenge: Optional[str] = None) -> dict[str, str]:
    """Sign ``<agent_id>.<challenge>`` with the agent's Ed25519 private key.

    The API accepts a signed challenge only once, within five minutes of the
    timestamp embedded in the challenge.
    """

    if not agent_id:
        raise ValueError("agent_id is required to sign a challenge.")
    serialization = _require_cryptography()
    try:
        key = serialization.load_pem_private_key(_normalize_pem(private_key_pem).encode("utf-8"), password=None)
    except (ValueError, TypeError) as error:
        raise KeelError(f"The agent private key is not a valid PEM key: {error}", code="invalid_private_key") from None
    if not hasattr(key, "sign"):
        raise KeelError("The agent private key must be Ed25519.", code="invalid_private_key")
    value = challenge or f"{int(time.time())}.{uuid.uuid4()}"
    signature = key.sign(f"{agent_id}.{value}".encode("utf-8"))
    return {"challenge": value, "signature": base64.b64encode(signature).decode("ascii")}


def generate_agent_keypair() -> dict[str, str]:
    """Generate a client-key-mode Ed25519 keypair and its fingerprint."""

    serialization = _require_cryptography()
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.generate()
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    der = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return {
        "public_key": public_pem.decode("ascii"),
        "private_key": private_pem.decode("ascii"),
        "fingerprint": hashlib.sha256(der).hexdigest(),
    }
