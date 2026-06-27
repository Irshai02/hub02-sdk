"""Own-backend tool example: a FastAPI API protected by the Hub02 SDK.

The Hub02 proxy injects the identity JWT as the `X-Hub02-Auth` header. The
`fastapi_dependency()` verifies it (Ed25519 vs JWKS) and returns a trusted
`Hub02User`. Key data on `user.id` (durable UUID), never on email.

    pip install -r requirements.txt
    uvicorn app:app --reload
    # Then, from behind the Hub02 proxy, or with a Bearer token:
    #   curl -H "Authorization: Bearer <jwt>" localhost:8000/my-plan
"""

from fastapi import Depends, FastAPI

from hub02_sdk.server import Hub02User, fastapi_dependency

app = FastAPI(title="Workout Planner")

# require_user verifies the identity token on every protected request.
# Pass tool_id="your-tool" to also bind the token to this tool.
require_user = fastapi_dependency()

# A "database" keyed on the durable Hub02 user id.
_plans: dict[str, list[str]] = {}


@app.get("/my-plan")
def my_plan(user: Hub02User = Depends(require_user)):
    return {"user_id": user.id, "items": _plans.get(user.id, [])}


@app.post("/my-plan")
def add_item(item: str, user: Hub02User = Depends(require_user)):
    _plans.setdefault(user.id, []).append(item)
    return {"user_id": user.id, "items": _plans[user.id]}


@app.get("/me")
def me(user: Hub02User = Depends(require_user)):
    return user
