"""End-to-end: the FastAPI dependency verifies a locally-minted Ed25519 token
and maps failures to HTTP 401. Skipped if FastAPI/Starlette aren't installed.

Drives the dependency with a real Starlette Request built from an ASGI scope
(no TestClient / httpx needed — keeps the suite offline and version-robust).
"""

import pytest

pytest.importorskip("fastapi")
starlette_requests = pytest.importorskip("starlette.requests")

from starlette.requests import Request  # noqa: E402

from hub02_sdk.server import fastapi_dependency  # noqa: E402
from tests._helpers import KeyPair, MockJwks, mint_token  # noqa: E402


def make_request(headers: dict[str, str]) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/my-plan",
        "headers": raw,
    }
    return Request(scope)


def test_fastapi_accepts_valid_token(keys: KeyPair, jwks: MockJwks):
    dep = fastapi_dependency(jwks_client=jwks)
    token = mint_token(keys, sub="fa-1", email="f@a.com")
    user = dep(make_request({"X-Hub02-Auth": token}))
    assert user.id == "fa-1"
    assert user.email == "f@a.com"


def test_fastapi_rejects_missing_token(jwks: MockJwks):
    from fastapi import HTTPException

    dep = fastapi_dependency(jwks_client=jwks)
    with pytest.raises(HTTPException) as exc:
        dep(make_request({}))
    assert exc.value.status_code == 401
    assert exc.value.detail["authenticated"] is False


def test_fastapi_rejects_bad_token(jwks: MockJwks):
    from fastapi import HTTPException

    dep = fastapi_dependency(jwks_client=jwks)
    with pytest.raises(HTTPException) as exc:
        dep(make_request({"X-Hub02-Auth": "garbage"}))
    assert exc.value.status_code == 401
