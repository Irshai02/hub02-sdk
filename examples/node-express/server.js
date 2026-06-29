/**
 * Own-backend tool example: an Express API protected by the Hub02 SDK.
 *
 * The Hub02 proxy injects the identity JWT as the `X-Hub02-Auth` header. We
 * verify it (Ed25519 vs JWKS) and trust `user.id` from the verified token —
 * never from a client field.
 *
 *   npm install
 *   node server.js
 *   # Then hit it from behind the Hub02 proxy, or with a Bearer token:
 *   #   curl -H "Authorization: Bearer <jwt>" localhost:3000/my-plan
 */
import express from "express";
import { authenticateHub02, hub02Auth } from "@hub02/sdk/server";

const app = express();

// A "database" keyed on the durable Hub02 user id.
const plans = new Map();

// Option A — explicit per-route guard.
app.get("/my-plan", async (req, res) => {
  try {
    const user = await authenticateHub02(req); // optionally { toolId: "my-tool" }
    const plan = plans.get(user.id) ?? { user_id: user.id, items: [] };
    res.json(plan);
  } catch (err) {
    res.status(401).json({ authenticated: false, error: String(err.message) });
  }
});

// Option B — middleware that attaches req.hub02User.
app.use(hub02Auth());
app.get("/me", (req, res) => res.json(req.hub02User));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`listening on http://localhost:${port}`));
