"""Hub02 SDK — server (framework-agnostic + FastAPI + Flask helpers).

Verifies Hub02 identity JWTs against the public JWKS using Ed25519, and turns
a request into a trusted :class:`Hub02User`.

SECURITY: always read ``user.id`` from the verified token — never from a
client-supplied field.

Usage::

    from hub02_sdk.server import authenticate_hub02
    user = authenticate_hub02(request)   # raises Hub02AuthError on invalid
"""

from __future__ import annotations

import threading
import time
from typing import Any, Optional

import jwt
from jwt import PyJWK, PyJWKClient

from ._shared import (
    HUB02_ALG,
    HUB02_AUD,
    HUB02_ISS,
    HUB02_JWKS_URL,
    Hub02AuthError,
    Hub02Claims,
    Hub02User,
    claims_to_user,
)

__all__ = [
    "verify_hub02_token",
    "authenticate_hub02",
    "extract_token",
    "fastapi_dependency",
    "flask_authenticate_hub02",
    "Hub02User",
    "Hub02Claims",
    "Hub02AuthError",
]


# --------------------------------------------------------------------------
# JWKS cache (by kid, TTL ~10m, refetch on unknown kid).
# --------------------------------------------------------------------------

_JWKS_TTL_SEC = 10 * 60


class _JwksCache:
    """Thread-safe JWKS resolver with a TTL and unknown-kid refetch."""

    def __init__(self, url: str) -> None:
        self._url = url
        self._client: Optional[PyJWKClient] = None
        self._fetched_at = 0.0
        self._lock = threading.Lock()

    def _client_fresh(self) -> PyJWKClient:
        now = time.time()
        with self._lock:
            if self._client is None or (now - self._fetched_at) > _JWKS_TTL_SEC:
                self._client = PyJWKClient(self._url, lifespan=_JWKS_TTL_SEC)
                self._fetched_at = now
            return self._client

    def get_key(self, token: str) -> PyJWK:
        client = self._client_fresh()
        try:
            return client.get_signing_key_from_jwt(token)
        except Exception:
            # Unknown kid → force a refetch once.
            with self._lock:
                self._client = PyJWKClient(self._url, lifespan=_JWKS_TTL_SEC)
                self._fetched_at = time.time()
                client = self._client
            return client.get_signing_key_from_jwt(token)


_caches: dict[str, _JwksCache] = {}
_caches_lock = threading.Lock()


def _resolve_key(token: str, jwks_url: str, jwks_client: Any) -> Any:
    if jwks_client is not None:
        # Caller-provided resolver (tests). Either a PyJWKClient-like with
        # get_signing_key_from_jwt, or a mapping kid->key.
        if hasattr(jwks_client, "get_signing_key_from_jwt"):
            return jwks_client.get_signing_key_from_jwt(token).key
        # mapping by kid
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        key = jwks_client.get(kid) if hasattr(jwks_client, "get") else None
        if key is None:
            raise Hub02AuthError(f"No key for kid {kid}")
        return key
    with _caches_lock:
        cache = _caches.get(jwks_url)
        if cache is None:
            cache = _JwksCache(jwks_url)
            _caches[jwks_url] = cache
    return cache.get_key(token).key


def verify_hub02_token(
    token: str,
    *,
    tool_id: Optional[str] = None,
    jwks_url: str = HUB02_JWKS_URL,
    jwks_client: Any = None,
    leeway: int = 5,
) -> Hub02Claims:
    """Verify a Hub02 identity JWT.

    Checks: Ed25519 signature vs JWKS, ``iss == "hub02"``,
    ``aud == "tool-identity"``, ``exp`` not passed (small leeway), and — if
    ``tool_id`` is supplied — that the ``tool_id`` claim matches.

    Raises :class:`Hub02AuthError` on any failure.
    """
    if not token or not isinstance(token, str):
        raise Hub02AuthError("Missing token")

    try:
        signing_key = _resolve_key(token, jwks_url, jwks_client)
    except Hub02AuthError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise Hub02AuthError(f"Could not resolve signing key: {exc}") from exc

    try:
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=[HUB02_ALG],
            issuer=HUB02_ISS,
            audience=HUB02_AUD,
            leeway=leeway,
            options={"require": ["exp", "sub"]},
        )
    except Exception as exc:  # noqa: BLE001  (PyJWT raises many subclasses)
        raise Hub02AuthError(f"Token verification failed: {exc}") from exc

    if not payload.get("sub"):
        raise Hub02AuthError("Token missing sub claim")

    if tool_id is not None and payload.get("tool_id") != tool_id:
        raise Hub02AuthError(f"Token tool_id mismatch (expected {tool_id})")

    return Hub02Claims(payload)


# --------------------------------------------------------------------------
# Request helpers
# --------------------------------------------------------------------------


def _get_header(request: Any, name: str) -> Optional[str]:
    """Read a header from common request objects (Starlette/FastAPI, Flask,
    Django, or a plain dict)."""
    lname = name.lower()
    headers = getattr(request, "headers", None)
    if headers is not None:
        # Starlette/Werkzeug headers are case-insensitive mappings.
        try:
            val = headers.get(name) or headers.get(lname)
            if val:
                return val
        except Exception:  # noqa: BLE001
            pass
    # Django style: request.META["HTTP_X_HUB02_AUTH"]
    meta = getattr(request, "META", None)
    if isinstance(meta, dict):
        key = "HTTP_" + name.upper().replace("-", "_")
        if meta.get(key):
            return meta[key]
    # Plain dict of headers.
    if isinstance(request, dict):
        return request.get(name) or request.get(lname)
    return None


def extract_token(request: Any) -> Optional[str]:
    """Extract the identity token: ``X-Hub02-Auth`` then ``Authorization:
    Bearer``."""
    direct = _get_header(request, "X-Hub02-Auth")
    if direct:
        return direct[7:].strip() if direct.lower().startswith("bearer ") else direct.strip()
    auth = _get_header(request, "Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


def authenticate_hub02(
    request: Any,
    *,
    tool_id: Optional[str] = None,
    jwks_url: str = HUB02_JWKS_URL,
    jwks_client: Any = None,
    leeway: int = 5,
) -> Hub02User:
    """Verify the request's identity token and return the trusted user.

    Framework-agnostic: accepts Starlette/FastAPI, Flask, Django, or a plain
    header dict. Raises :class:`Hub02AuthError` (status 401) when no valid
    token is present.
    """
    token = extract_token(request)
    if not token:
        raise Hub02AuthError("No Hub02 identity token on request")
    claims = verify_hub02_token(
        token,
        tool_id=tool_id,
        jwks_url=jwks_url,
        jwks_client=jwks_client,
        leeway=leeway,
    )
    return claims_to_user(claims)


# --------------------------------------------------------------------------
# FastAPI dependency
# --------------------------------------------------------------------------


def fastapi_dependency(*, tool_id: Optional[str] = None, **kwargs: Any):
    """Build a FastAPI dependency that returns a :class:`Hub02User`.

    Usage::

        from fastapi import Depends
        from hub02_sdk.server import fastapi_dependency
        require_user = fastapi_dependency()

        @app.get("/my-plan")
        def my_plan(user = Depends(require_user)):
            return get_plan(user.id)
    """

    def _dep(request: Any) -> Hub02User:
        try:
            return authenticate_hub02(request, tool_id=tool_id, **kwargs)
        except Hub02AuthError as exc:
            try:
                from fastapi import HTTPException
            except ImportError as ie:  # pragma: no cover
                raise exc from ie
            raise HTTPException(
                status_code=401,
                detail={"authenticated": False, "error": str(exc)},
            ) from exc

    return _dep


# --------------------------------------------------------------------------
# Flask helper
# --------------------------------------------------------------------------


def flask_authenticate_hub02(*, tool_id: Optional[str] = None, **kwargs: Any) -> Hub02User:
    """Flask helper: read the current request and return a trusted user.

    Call inside a view (uses ``flask.request``). Raises
    :class:`Hub02AuthError` (status 401) on failure — register an error
    handler, or wrap in try/except and return a 401 JSON body.
    """
    from flask import request as flask_request

    return authenticate_hub02(flask_request, tool_id=tool_id, **kwargs)
