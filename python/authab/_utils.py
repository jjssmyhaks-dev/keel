"""Small helpers shared by resources."""

from __future__ import annotations

import urllib.parse
from typing import Any

UNSET: Any = object()


def seg(value: str) -> str:
    """Encode one path segment."""

    return urllib.parse.quote(str(value), safe="")


def payload(**fields: Any) -> dict[str, Any]:
    """Build a JSON payload, keeping explicit ``None`` but dropping omitted fields."""

    return {key: value for key, value in fields.items() if value is not UNSET}


def body(**fields: Any) -> dict[str, Any]:
    """Build a create/call payload, dropping both omitted fields and ``None``."""

    return {key: value for key, value in fields.items() if value is not UNSET and value is not None}


def query(**fields: Any) -> dict[str, Any]:
    return {key: value for key, value in fields.items() if value is not None and value != ""}
