"""Hub02 SDK — client-side helpers (Python).

Client-side Python is minimal — most Python use is server-side. This module
provides a helper to read an already-established Hub02 identity from a
forwarded header (e.g. SSR frameworks where the proxy injected
``X-Hub02-*`` / ``window.__HUB02__`` upstream), plus the ``Hub02User`` type.

For real authorization, verify the token on the server with
:func:`hub02_sdk.server.require_hub02_user` — never trust a forwarded
identity field without verifying the signed token.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from ._shared import Hub02User

__all__ = ["Hub02User", "user_from_window_identity", "user_from_me_response"]


def user_from_window_identity(data: Any) -> Optional[Hub02User]:
    """Build a :class:`Hub02User` from a ``window.__HUB02__`` JSON blob.

    Accepts a dict or a JSON string. Returns ``None`` if no ``user_id``.
    Display-only: do not use as an authorization decision on its own.
    """
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except (ValueError, TypeError):
            return None
    if not isinstance(data, dict):
        return None
    user_id = data.get("user_id") or data.get("id")
    if not user_id:
        return None
    return Hub02User(
        id=user_id,
        hub_id=data.get("hub_id"),
        tool_id=data.get("tool_id"),
        email=data.get("email"),
        name=data.get("name"),
    )


def user_from_me_response(data: Any) -> Optional[Hub02User]:
    """Build a :class:`Hub02User` from a ``GET /__hub02/me`` JSON body.

    Returns ``None`` when ``authenticated`` is false or no ``user_id``.
    """
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except (ValueError, TypeError):
            return None
    if not isinstance(data, dict) or not data.get("authenticated"):
        return None
    user_id = data.get("user_id")
    if not user_id:
        return None
    return Hub02User(
        id=user_id,
        hub_id=data.get("hub_id"),
        tool_id=data.get("tool_id"),
        email=data.get("email"),
        name=data.get("name"),
    )
