import pytest

from hub02_sdk.server import (
    Hub02AuthError,
    extract_token,
    authenticate_hub02,
    verify_hub02_token,
)
from tests._helpers import KeyPair, MockJwks, make_keys, mint_token


def test_verify_valid_token(keys: KeyPair, jwks: MockJwks):
    token = mint_token(keys, sub="user-1", email="a@b.com", name="Ada")
    claims = verify_hub02_token(token, jwks_client=jwks)
    assert claims["sub"] == "user-1"
    assert claims["iss"] == "hub02"
    assert claims["aud"] == "tool-identity"
    assert claims["hub_id"] == "hub-123"
    assert claims["tool_id"] == "tool-abc"
    assert claims["email"] == "a@b.com"
    assert claims["name"] == "Ada"


def test_wrong_issuer_rejected(keys: KeyPair, jwks: MockJwks):
    token = mint_token(keys, iss="evil")
    with pytest.raises(Hub02AuthError):
        verify_hub02_token(token, jwks_client=jwks)


def test_wrong_audience_rejected(keys: KeyPair, jwks: MockJwks):
    token = mint_token(keys, aud="some-other-aud")
    with pytest.raises(Hub02AuthError):
        verify_hub02_token(token, jwks_client=jwks)


def test_expired_token_rejected(keys: KeyPair, jwks: MockJwks):
    token = mint_token(keys, exp_seconds_from_now=-120)
    with pytest.raises(Hub02AuthError):
        verify_hub02_token(token, jwks_client=jwks)


def test_unknown_key_rejected(jwks: MockJwks):
    other = make_keys("kid-B")
    token = mint_token(other)
    with pytest.raises(Hub02AuthError):
        verify_hub02_token(token, jwks_client=jwks)


def test_tool_id_match_enforced(keys: KeyPair, jwks: MockJwks):
    token = mint_token(keys, tool_id="tool-A")
    with pytest.raises(Hub02AuthError):
        verify_hub02_token(token, tool_id="tool-B", jwks_client=jwks)
    claims = verify_hub02_token(token, tool_id="tool-A", jwks_client=jwks)
    assert claims["tool_id"] == "tool-A"


def test_empty_token_rejected(jwks: MockJwks):
    with pytest.raises(Hub02AuthError):
        verify_hub02_token("", jwks_client=jwks)
    with pytest.raises(Hub02AuthError):
        verify_hub02_token(None, jwks_client=jwks)  # type: ignore[arg-type]


# ---- extract_token --------------------------------------------------------


def test_extract_token_x_hub02_auth():
    assert extract_token({"X-Hub02-Auth": "abc"}) == "abc"


def test_extract_token_strips_bearer():
    assert extract_token({"X-Hub02-Auth": "Bearer abc"}) == "abc"


def test_extract_token_authorization():
    assert extract_token({"Authorization": "Bearer xyz"}) == "xyz"


def test_extract_token_prefers_x_hub02():
    assert extract_token({"X-Hub02-Auth": "a", "Authorization": "Bearer b"}) == "a"


def test_extract_token_none():
    assert extract_token({}) is None


# ---- authenticate_hub02 ---------------------------------------------------


def test_require_user_returns_trusted_user(keys: KeyPair, jwks: MockJwks):
    token = mint_token(keys, sub="u-42", email="e@x.com", name="Grace")
    user = authenticate_hub02({"X-Hub02-Auth": token}, jwks_client=jwks)
    assert user.id == "u-42"
    assert user.email == "e@x.com"
    assert user.name == "Grace"


def test_require_user_no_token_raises(jwks: MockJwks):
    with pytest.raises(Hub02AuthError) as exc:
        authenticate_hub02({}, jwks_client=jwks)
    assert exc.value.status == 401


def test_require_user_with_request_headers_object(keys: KeyPair, jwks: MockJwks):
    """Simulate a Starlette/Werkzeug-style request with a .headers mapping."""

    class FakeReq:
        def __init__(self, headers):
            self.headers = headers

    token = mint_token(keys, sub="u-hdr")
    req = FakeReq({"x-hub02-auth": token})
    user = authenticate_hub02(req, jwks_client=jwks)
    assert user.id == "u-hdr"


# --- try_authenticate_hub02 / CORS helpers --------------------------------


def test_try_auth_returns_user_for_valid_hub02_header(keys: KeyPair, jwks: MockJwks):
    from hub02_sdk.server import try_authenticate_hub02

    token = mint_token(keys, sub="u-try")
    user = try_authenticate_hub02({"X-Hub02-Auth": token}, jwks_client=jwks)
    assert user is not None and user.id == "u-try"


def test_try_auth_returns_none_when_absent(jwks: MockJwks):
    from hub02_sdk.server import try_authenticate_hub02

    assert try_authenticate_hub02({}, jwks_client=jwks) is None


def test_try_auth_raises_on_invalid_hub02_header(jwks: MockJwks):
    from hub02_sdk.server import try_authenticate_hub02

    with pytest.raises(Hub02AuthError):
        try_authenticate_hub02({"X-Hub02-Auth": "garbage"}, jwks_client=jwks)


def test_try_auth_uses_hub02_bearer(keys: KeyPair, jwks: MockJwks):
    from hub02_sdk.server import try_authenticate_hub02

    token = mint_token(keys, sub="u-bearer")
    user = try_authenticate_hub02({"Authorization": f"Bearer {token}"}, jwks_client=jwks)
    assert user is not None and user.id == "u-bearer"


def test_try_auth_ignores_foreign_and_opaque_bearer(keys: KeyPair, jwks: MockJwks):
    from hub02_sdk.server import try_authenticate_hub02

    foreign = mint_token(keys, iss="other-idp")  # valid JWT, wrong issuer
    assert try_authenticate_hub02({"Authorization": f"Bearer {foreign}"}, jwks_client=jwks) is None
    assert try_authenticate_hub02({"Authorization": "Bearer opaque-123"}, jwks_client=jwks) is None


def test_is_hub02_origin():
    from hub02_sdk.server import is_hub02_origin

    assert is_hub02_origin("https://parlex-test.tools.hub02.com") is True
    assert is_hub02_origin("https://tools.hub02.com") is True
    assert is_hub02_origin("https://evil.com") is False
    assert is_hub02_origin("http://x.tools.hub02.com") is False
    assert is_hub02_origin("https://tools.hub02.com.evil.com") is False
    assert is_hub02_origin(None) is False


def test_hub02_cors_kwargs_defaults_and_override():
    from hub02_sdk.server import hub02_cors_kwargs

    k = hub02_cors_kwargs()
    assert "X-Hub02-Auth" in k["allow_headers"]
    assert k["allow_credentials"] is True
    k2 = hub02_cors_kwargs(allow_origins=["https://my.com"])
    assert k2["allow_origins"] == ["https://my.com"]
