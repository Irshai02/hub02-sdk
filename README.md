# `@hub02/sdk` — Hub02 tool-identity SDK

Add **"Sign in with Hub02"** to a published tool: read the signed-in user on the
client (~2 lines) and authorize API calls on your backend (1 guard) — **no
second login**. Node + browser and Python, in one repo.

> Token algorithm is **EdDSA / Ed25519** (not ES256), `iss="hub02"`,
> `aud="tool-identity"`. Public JWKS:
> `https://ddeubhasvmeqwtzgkunt.supabase.co/functions/v1/jwks`.

## What's here

| Path | What |
|---|---|
| [`node/`](./node) | `@hub02/sdk` — client (`hub02.user()`), `./server` (verify Ed25519 tokens), `./react`. ESM + CJS + types + an IIFE browser bundle. |
| [`python/`](./python) | `hub02-sdk` — `hub02_sdk` + `hub02_sdk.server` (framework-agnostic + FastAPI + Flask). |
| [`examples/`](./examples) | `node-express`, `node-browser` (Base44-style), `python-fastapi`. |
| [`docs/`](./docs) | [Integration guide](./docs/integration-guide.md), and **agentic install**: [`install/PROMPT.md`](./docs/install/PROMPT.md) (any coding agent) + [`install/SKILL.md`](./docs/install/SKILL.md). |

## Quick start

**Client** (any tool, including Base44 — no backend needed):
```js
import { hub02 } from "@hub02/sdk";
const user = await hub02.user();          // { id, email, name } — already signed in
```

**Server** (own-backend tools):
```js
import { authenticateHub02 } from "@hub02/sdk/server";
app.get("/my-plan", async (req, res) => {
  const user = await authenticateHub02(req); // verifies Ed25519 vs JWKS
  res.json(getPlan(user.id));               // trust user.id from the token, never the client
});
```

**Python server:**
```python
from hub02_sdk.server import authenticate_hub02
user = authenticate_hub02(request)          # raises on invalid; returns Hub02User
```

See [`node/README.md`](./node/README.md) and [`python/README.md`](./python/README.md)
for the full API, and the [integration guide](./docs/integration-guide.md) for the
worked example, the `user_id`-vs-email durable-key rule, and the security checklist.

## Develop (offline, no secrets)

```bash
# Node
cd node && npm install && npm run build && npm test
# Python
cd python && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && pytest
```

Tests generate a local Ed25519 keypair + a mock JWKS — no network, no Hub02
secrets.

## Publishing

Not published to npm/PyPI yet. Publish workflows
([`.github/workflows/`](./.github/workflows)) are **tag-gated and not triggered**
(`node-publish.yml`, `python-publish.yml`). Reserved names: npm `@hub02/sdk`,
PyPI `hub02-sdk`.

## License

[MIT](./LICENSE).
