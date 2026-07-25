from hub02_sdk.oidc import generate_pkce, handle_hub02_callback, HUB02_OIDC_COOKIE_STATE


class FakeRequest:
    def __init__(self, query=None, cookie=""):
        self.args = query or {}
        self.headers = {"Cookie": cookie}


def test_generate_pkce_has_required_fields():
    pkce = generate_pkce()
    assert len(pkce["verifier"]) >= 40
    assert pkce["challenge"]
    assert pkce["state"]
    assert pkce["nonce"]


def test_handle_hub02_callback_rejects_invalid_state():
    body, status = handle_hub02_callback(
        FakeRequest({"code": "c", "state": "wrong"}, f"{HUB02_OIDC_COOKIE_STATE}=expected"),
        client_id="hub02_test",
        client_secret="sec_test",
        redirect_uri="https://demo.tools.hub02.com/auth/hub02/callback",
        on_user=lambda _u, _r: None,
    )
    assert status == 400
    assert body["error"] == "invalid_state"
