# Example — browser-only tool (Base44-style)

No backend, no build step. The Hub02 proxy injects identity; the SDK reads it
via `window.__HUB02__` → fallback `GET /__hub02/me`.

Two ways to load the client:

- **CDN / IIFE** (this example): `<script src=".../dist/sdk.global.js">` →
  `window.hub02.user()`.
- **Bundled**: `import { hub02 } from "@hub02/sdk"`.

```bash
# Build the IIFE bundle first:
( cd ../../node && npm install && npm run build )
# Then serve this folder behind the Hub02 proxy (window.__HUB02__ is injected there).
```

Key file: [`index.html`](./index.html) — `hub02.user()`, the `user.id` durable-key
rule, and `hub02.onExpire()`.
