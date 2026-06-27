"""Importable test helpers: local Ed25519 keypair, token minting, mock JWKS.
No network, no Hub02 secrets."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Optional

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from hub02_sdk._shared import HUB02_AUD, HUB02_ISS


@dataclass
class KeyPair:
    private_key: Ed25519PrivateKey
    public_key: Any
    kid: str


def make_keys(kid: str = "test-key-1") -> KeyPair:
    private_key = Ed25519PrivateKey.generate()
    return KeyPair(private_key=private_key, public_key=private_key.public_key(), kid=kid)


def mint_token(
    keys: KeyPair,
    *,
    sub: str = "11111111-1111-1111-1111-111111111111",
    hub_id: str = "hub-123",
    tool_id: str = "tool-abc",
    email: Optional[str] = None,
    name: Optional[str] = None,
    iss: str = HUB02_ISS,
    aud: str = HUB02_AUD,
    exp_seconds_from_now: int = 300,
    iat: Optional[int] = None,
) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "hub_id": hub_id,
        "tool_id": tool_id,
        "iss": iss,
        "aud": aud,
        "iat": iat if iat is not None else now,
        "exp": now + exp_seconds_from_now,
    }
    if email is not None:
        payload["email"] = email
    if name is not None:
        payload["name"] = name
    return jwt.encode(
        payload,
        keys.private_key,
        algorithm="EdDSA",
        headers={"kid": keys.kid},
    )


class MockJwks:
    """A kid->public-key mapping accepted by verify_hub02_token's
    ``jwks_client`` arg."""

    def __init__(self, *keys: KeyPair) -> None:
        self._by_kid = {k.kid: k.public_key for k in keys}

    def get(self, kid: Optional[str]) -> Any:
        return self._by_kid.get(kid)
