import type { Context } from "hono";
import type { Detail } from "./params";

export const error = (c: Context, status: number, message: string) =>
  c.json({ error: message }, status as any);
export const notFound = (c: Context, resource: string, id: string) => error(c, 404, `${resource} '${id}' not found`);
export const forbidden = (c: Context, detail = "Forbidden") => error(c, 403, detail);
export const validationFailed = (c: Context, details: Detail[]) =>
  c.json({ error: "Validation failed", details }, 400);
export const noContent = (c: Context) => c.body(null, 204);

/** Parses a JSON object body, or answers with the 400 the CLI expects. */
export async function jsonBody(c: Context): Promise<Record<string, unknown> | Response> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return validationFailed(c, [{ type: "json_invalid", loc: ["body"], msg: "Invalid JSON" }]);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return validationFailed(c, [{ type: "model_type", loc: ["body"], msg: "Input should be an object" }]);
  return parsed as Record<string, unknown>;
}
