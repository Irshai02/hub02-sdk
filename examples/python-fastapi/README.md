# Example — Python + FastAPI (own-backend tool)

A tool backend behind the Hub02 proxy. The proxy injects the identity JWT as
`X-Hub02-Auth`; `fastapi_dependency()` verifies it and returns a trusted
`Hub02User`. Data is keyed on `user.id`.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload   # http://localhost:8000
```

Try it (behind the proxy, or with a Bearer token):

```bash
curl -H "Authorization: Bearer <identity-jwt>" http://localhost:8000/my-plan
```

Key file: [`app.py`](./app.py) — `fastapi_dependency()` + `Depends(require_user)`.
