from hub02_sdk import Hub02User, user_from_me_response, user_from_window_identity


def test_user_from_window_identity_dict():
    u = user_from_window_identity(
        {
            "user_id": "u-1",
            "hub_id": "h-1",
            "tool_id": "t-1",
            "email": "x@y.com",
            "name": "Linus",
        }
    )
    assert u == Hub02User(
        id="u-1", hub_id="h-1", tool_id="t-1", email="x@y.com", name="Linus"
    )


def test_user_from_window_identity_json_string():
    u = user_from_window_identity('{"user_id":"u-2"}')
    assert u is not None
    assert u.id == "u-2"


def test_user_from_window_identity_missing_id():
    assert user_from_window_identity({"hub_id": "h"}) is None
    assert user_from_window_identity("not json") is None
    assert user_from_window_identity(None) is None


def test_user_from_me_response_authenticated():
    u = user_from_me_response(
        {"authenticated": True, "user_id": "u-3", "email": "p@q.com"}
    )
    assert u is not None
    assert u.id == "u-3"
    assert u.email == "p@q.com"


def test_user_from_me_response_unauthenticated():
    assert (
        user_from_me_response({"authenticated": False, "login_url": "https://login"})
        is None
    )
    assert user_from_me_response({"authenticated": True}) is None
