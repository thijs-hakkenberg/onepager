import { Hono } from "hono";
import { requireCaller } from "../auth/middleware";
import * as tokens from "../domain/tokens";
import type { AppEnv } from "../env";
import { jsonBody, noContent, notFound, validationFailed } from "../lib/http";
import { validate } from "../lib/params";
import { iso8601 } from "../lib/time";

export const tokensApi = new Hono<AppEnv>();
tokensApi.use("*", requireCaller("session"));

tokensApi.post("/", async (c) => {
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const v = validate(body, [{ field: "name", strip: true, min: 1, max: 100 }]);
  if (!v.ok) return validationFailed(c, v.details);
  const t = await tokens.create(c.env, c.var.caller.id, v.values.name);
  return c.json({ token_id: t.token_id, name: t.name, full_token: t.full, created_at: iso8601(t.created_at) }, 201);
});

tokensApi.get("/", async (c) => {
  const list = await tokens.list(c.env, c.var.caller.id);
  return c.json({
    tokens: list.map((t) => ({ ...t, created_at: iso8601(t.created_at), last_used_at: iso8601(t.last_used_at) })),
  });
});

tokensApi.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await tokens.remove(c.env, c.var.caller.id, id))) return notFound(c, "Token", id);
  return noContent(c);
});
