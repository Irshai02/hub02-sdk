"""Shared constants and types for the Hub02 SDK.

These pin the contract so client and server halves cannot drift:
  - JWKS endpoint (public Ed25519 keys)
  - token issuer (``iss``)
  - token audience (``aud``)

Token algorithm is EdDSA / Ed25519 (NOT ES256).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

#: Public JWKS endpoint exposing Hub02's Ed25519 verification keys.
HUB02_JWKS_URL = "https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks"

#: Expected ``iss`` claim on a Hub02 identity token.
HUB02_ISS = "hub02"

#: Expected ``aud`` claim on a Hub02 identity token.
HUB02_AUD = "tool-identity"

#: Signing / verification algorithm. EdDSA over the Ed25519 curve.
HUB02_ALG = "EdDSA"

#: Same-origin pull endpoint the proxy exposes for client identity.
HUB02_ME_PATH = "/__hub02/me"


@dataclass
class Hub02User:
    """Identity returned to application code.

    ``id`` is the durable Hub02 user UUID (the ``sub`` claim) — builders MUST
    key their data on this. ``email`` / ``name`` are display-only and may
    change.
    """

    id: str
    hub_id: Optional[str] = None
    tool_id: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None


class Hub02Claims(dict):
    """Raw verified claims from a Hub02 identity JWT (a plain dict).

    Common keys: ``sub``, ``iss``, ``aud``, ``hub_id``, ``tool_id``,
    ``email``, ``name``, ``iat``, ``exp``.
    """

    @property
    def sub(self) -> str:
        return self["sub"]


class Hub02AuthError(Exception):
    """Raised when token verification or authorization fails.

    Carries ``status = 401`` so framework handlers can map it directly.
    """

    status = 401


def claims_to_user(claims: dict[str, Any]) -> Hub02User:
    """Map verified claims to the public :class:`Hub02User`."""
    return Hub02User(
        id=claims["sub"],
        hub_id=claims.get("hub_id"),
        tool_id=claims.get("tool_id"),
        email=claims.get("email"),
        name=claims.get("name"),
    )
