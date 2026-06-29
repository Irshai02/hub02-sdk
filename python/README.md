# `hub02-sdk` (Python)

Verify Hub02 tool-identity tokens (Ed25519) on your Python backend, and read
the signed-in user — no second login.

> Token algorithm is **EdDSA / Ed25519**, `iss="hub02"`, `aud="tool-identity"`.
> JWKS: `https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks`.

## Install

```bash
pip install hub02-sdk            # not yet published — install from the repo for now
# pip install "git+https://github.com/Irshai02/hub02-sdk.git#subdirectory=python"
```

## Server — verify on your backend

The Hub02 proxy injects the identity JWT as the `X-Hub02-Auth` header (also
accepts `Authorization: Bearer <jwt>`). Always trust `user.id` from the
verified token, never a client-supplied field.

### Framework-agnostic

```python
from hub02_sdk.server import authenticate_hub02, Hub02AuthError

try:
    user = authenticate_hub02(request)   # request: FastAPI/Starlette, Flask, Django, or header dict
    plan = get_plan(user.id)             # key your data on user.id (durable UUID)
except Hub02AuthError:
    ...                                   # 401
```

### FastAPI

```python
from fastapi import FastAPI, Depends
from hub02_sdk.server import fastapi_dependency, Hub02User

require_user = fastapi_dependency()       # optionally fastapi_dependency(tool_id="my-tool")
app = FastAPI()

@app.get("/my-plan")
def my_plan(user: Hub02User = Depends(require_user)):
    return get_plan(user.id)
```

### Flask

```python
from flask import Flask, jsonify
from hub02_sdk.server import flask_authenticate_hub02, Hub02AuthError

app = Flask(__name__)

@app.get("/my-plan")
def my_plan():
    try:
        user = flask_authenticate_hub02()
    except Hub02AuthError as e:
        return jsonify(authenticated=False, error=str(e)), 401
    return jsonify(get_plan(user.id))
```

## Public API

| Name | Signature | Purpose |
|---|---|---|
| `verify_hub02_token` | `(token, *, tool_id=None, jwks_url=…, leeway=5) -> Hub02Claims` | Verify Ed25519 token vs JWKS; checks `iss`/`aud`/`exp`/optional `tool_id`. Raises `Hub02AuthError`. |
| `authenticate_hub02` | `(request, *, tool_id=None, …) -> Hub02User` | Extract + verify token from a request; raises `Hub02AuthError` (status 401). |
| `extract_token` | `(request) -> str | None` | Pull token from `X-Hub02-Auth` / `Authorization: Bearer`. |
| `fastapi_dependency` | `(*, tool_id=None, …) -> Depends-able` | FastAPI dependency returning `Hub02User`; raises `HTTPException(401)`. |
| `flask_authenticate_hub02` | `(*, tool_id=None, …) -> Hub02User` | Flask helper using `flask.request`. |
| `Hub02User` | dataclass `{ id, hub_id, tool_id, email, name }` | Trusted identity. Key data on `id`. |
| `Hub02Claims` | dict subclass | Raw verified claims. |
| `Hub02AuthError` | exception (`status = 401`) | Raised on any verification failure. |

Client helpers (SSR / forwarded identity, in `hub02_sdk`):
`user_from_window_identity(data)`, `user_from_me_response(data)`.

## Develop / test (offline, no secrets)

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest
```

Tests generate a local Ed25519 keypair and a mock JWKS — no network, no Hub02
secrets.

## License

MIT.
