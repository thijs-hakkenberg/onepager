import type { Context } from "hono";
import type { AppEnv } from "../env";

// Optional, fire-and-forget: nothing is sent unless MIXPANEL_TOKEN is set, and a
// failed send never affects the response.
export function track(c: Context<AppEnv>, event: string, properties: Record<string, unknown> = {}) {
  const token = c.env.MIXPANEL_TOKEN;
  if (!token) return;
  const distinct_id = c.var.caller?.id ?? "anonymous";
  const payload = [{ event, properties: { token, distinct_id, time: Date.now(), ...properties } }];
  const send = fetch("https://api-eu.mixpanel.com/track", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/plain" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(send);
  } catch {
    // no execution context (tests)
  }
}
