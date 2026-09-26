import { Hono } from "hono";
import { auth } from "./auth/oauth";
import type { AppEnv } from "./env";
import { groupsApi } from "./routes/groups";
import { api } from "./routes/onepagers";
import { pages } from "./routes/pages";
import { tokensApi } from "./routes/tokens";

export const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ status: "ok" }, 200, { "cache-control": "no-store" }));

app.route("/api/v1/onepagers", api);
app.route("/api/v1/groups", groupsApi);
app.route("/api/v1/tokens", tokensApi);
app.route("/", auth);
app.route("/", pages);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
