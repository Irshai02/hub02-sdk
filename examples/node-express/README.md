# Example — Node + Express (own-backend tool)

A tool that runs its own backend behind the Hub02 proxy. The proxy injects the
identity JWT as `X-Hub02-Auth`; we verify it with `@hub02/sdk/server` and key
data on the trusted `user.id`.

```bash
npm install        # links @hub02/sdk via file:../../node — run `npm run build` in node/ first
npm start          # http://localhost:3000
```

Try it (mint a token with the SDK's test helper, or run behind the proxy):

```bash
curl -H "Authorization: Bearer <identity-jwt>" http://localhost:3000/my-plan
```

Key files: [`server.js`](./server.js) — `authenticateHub02(req)` and the
`hub02Auth()` middleware.
