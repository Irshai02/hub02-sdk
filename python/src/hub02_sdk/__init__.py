"""Hub02 SDK — read the signed-in Hub02 user and verify identity tokens.

Public surface::

    from hub02_sdk import Hub02User
    from hub02_sdk.server import verify_hub02_token, authenticate_hub02

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
from .oidc import (
    HUB02_OIDC_CALLBACK_PATH,
    HUB02_OIDC_ISSUER_DEFAULT,
    Hub02OidcError,
    exchange_hub02_code,
    generate_pkce,
    handle_hub02_callback,
    verify_hub02_id_token,
)

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
    "HUB02_OIDC_ISSUER_DEFAULT",
    "HUB02_OIDC_CALLBACK_PATH",
    "Hub02OidcError",
    "exchange_hub02_code",
    "verify_hub02_id_token",
    "handle_hub02_callback",
    "generate_pkce",
]

__version__ = "0.5.0"
