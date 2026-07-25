"""Hub02 OIDC — server helpers (code exchange + ID token verification)."""

from __future__ import annotations

import base64
import hashlib
import secrets
import threading
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlparse

import jwt
import requests
from jwt import PyJWKClient

HUB02_OIDC_ISSUER_DEFAULT = "https://id.hub02.com"
HUB02_OIDC_CALLBACK_PATH = "/auth/hub02/callback"
HUB02_OIDC_COOKIE_VERIFIER = "hub02_oidc_pkce_verifier"
HUB02_OIDC_COOKIE_STATE = "hub02_oidc_state"
HUB02_OIDC_COOKIE_NONCE = "hub02_oidc_nonce"


class Hub02OidcError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


class Hub02OidcUser(dict):
    """Verified OIDC user claims (`sub`, `email`, `name`, ...)."""

    @property
    def id(self) -> str:
        return self["id"]


_jwks_clients: dict[str, PyJWKClient] = {}
_jwks_lock = threading.Lock()


def _jwks_client(issuer: str) -> PyJWKClient:
    url = f"{issuer.rstrip('/')}/.well-known/jwks.json"
    with _jwks_lock:
        client = _jwks_clients.get(url)
        if client is None:
            client = PyJWKClient(url, lifespan=600)
            _jwks_clients[url] = client
        return client


def exchange_hub02_code(
    *,
    code: str,
    redirect_uri: str,
    code_verifier: str,
    client_id: str,
    client_secret: str,
    issuer: str = HUB02_OIDC_ISSUER_DEFAULT,
) -> dict[str, Any]:
    """Exchange an authorization code at ``{issuer}/token``."""
    token_url = f"{issuer.rstrip('/')}/token"
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    res = requests.post(
        token_url,
        headers={
            "Authorization": f"Basic {basic}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        },
        timeout=30,
    )
    body = res.json() if res.content else {}
    if not res.ok:
        msg = body.get("error_description") or body.get("error") or "token_exchange_failed"
        raise Hub02OidcError(str(msg), res.status_code)
    return body


def verify_hub02_id_token(
    id_token: str,
    *,
    client_id: str,
    issuer: str = HUB02_OIDC_ISSUER_DEFAULT,
    nonce: Optional[str] = None,
) -> Hub02OidcUser:
    """Verify an RS256 OIDC ID token from Hub02."""
    key = _jwks_client(issuer).get_signing_key_from_jwt(id_token).key
    payload = jwt.decode(
        id_token,
        key,
        algorithms=["RS256"],
        issuer=issuer.rstrip("/"),
        audience=client_id,
        options={"require": ["exp", "sub"]},
    )
    if nonce is not None and payload.get("nonce") != nonce:
        raise Hub02OidcError("nonce_mismatch", 401)
    return Hub02OidcUser(
        {
            "id": payload["sub"],
            "email": payload.get("email"),
            "name": payload.get("name"),
            "hub02_tool_id": payload.get("hub02_tool_id"),
            "nonce": payload.get("nonce"),
        }
    )


def _read_cookie(request: Any, name: str) -> Optional[str]:
    headers = getattr(request, "headers", None)
    raw = None
    if headers is not None:
        raw = headers.get("cookie") or headers.get("Cookie")
    if not raw:
        return None
    for part in raw.split(";"):
        k, _, v = part.strip().partition("=")
        if k == name:
            return v
    return None


def _query_param(request: Any, key: str) -> Optional[str]:
    args = getattr(request, "args", None)
    if args is not None and hasattr(args, "get"):
        val = args.get(key)
        if isinstance(val, list):
            return val[0] if val else None
        return val
    url = getattr(request, "url", None)
    if url:
        return parse_qs(urlparse(str(url)).query).get(key, [None])[0]
    return None


def handle_hub02_callback(
    request: Any,
    *,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    on_user: Callable[[Hub02OidcUser, Any], Any],
    issuer: str = HUB02_OIDC_ISSUER_DEFAULT,
) -> tuple[dict[str, Any], int]:
    """Framework-agnostic callback handler. Returns ``(body, status_code)``."""
    err = _query_param(request, "error")
    if err:
        return {"error": err, "error_description": _query_param(request, "error_description")}, 400

    code = _query_param(request, "code")
    state = _query_param(request, "state")
    if not code or not state:
        return {"error": "missing_code_or_state"}, 400

    expected_state = _read_cookie(request, HUB02_OIDC_COOKIE_STATE)
    if not expected_state or expected_state != state:
        return {"error": "invalid_state"}, 400

    verifier = _read_cookie(request, HUB02_OIDC_COOKIE_VERIFIER)
    if not verifier:
        return {"error": "missing_pkce_verifier"}, 400

    nonce = _read_cookie(request, HUB02_OIDC_COOKIE_NONCE)

    try:
        tokens = exchange_hub02_code(
            code=code,
            redirect_uri=redirect_uri,
            code_verifier=verifier,
            client_id=client_id,
            client_secret=client_secret,
            issuer=issuer,
        )
        user = verify_hub02_id_token(
            tokens["id_token"],
            client_id=client_id,
            issuer=issuer,
            nonce=nonce,
        )
        on_user(user, request)
        return {"ok": True}, 200
    except Hub02OidcError as exc:
        return {"error": "oidc_callback_failed", "message": str(exc)}, exc.status
    except Exception as exc:  # noqa: BLE001
        return {"error": "oidc_callback_failed", "message": str(exc)}, 401


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def generate_pkce() -> dict[str, str]:
    verifier = b64url(secrets.token_bytes(32))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    return {
        "verifier": verifier,
        "challenge": challenge,
        "state": b64url(secrets.token_bytes(16)),
        "nonce": b64url(secrets.token_bytes(16)),
    }
