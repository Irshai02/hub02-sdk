"""Hub02 SDK — read the signed-in Hub02 user and verify identity tokens.

Public surface::

    from hub02_sdk import Hub02User
    from hub02_sdk.server import verify_hub02_token, require_hub02_user

Token algorithm is EdDSA / Ed25519, ``iss="hub02"``, ``aud="tool-identity"``.
"""

from ._shared import (
    HUB02_ALG,
    HUB02_AUD,
    HUB02_ISS,
    HUB02_JWKS_URL,
    HUB02_ME_PATH,
    Hub02AuthError,
    Hub02Claims,
    Hub02User,
)
from .client import user_from_me_response, user_from_window_identity

__all__ = [
    "Hub02User",
    "Hub02Claims",
    "Hub02AuthError",
    "HUB02_JWKS_URL",
    "HUB02_ISS",
    "HUB02_AUD",
    "HUB02_ALG",
    "HUB02_ME_PATH",
    "user_from_window_identity",
    "user_from_me_response",
]

__version__ = "0.1.0"
