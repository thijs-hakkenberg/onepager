import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import * as tokens from "../domain/tokens";
import type { AppEnv, Caller } from "../env";
import { parseBearer } from "./token";
import * as users from "./users";

export const SESSION_COOKIE = "op_session";
export type Policy = "bearer" | "session" | "any";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

async function fromSession(c: Context<AppEnv>): Promise<Caller | null> {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (!cookie) return null;
  const user = await users.sessionUser(c.env, cookie);
  return user && { ...user, via: "session" };
}

async function fromBearer(c: Context<AppEnv>): Promise<Caller | null> {
  const parsed = parseBearer(c.req.header("authorization"));
  if (!parsed) return null;
  const ownerId = await tokens.verify(c.env, parsed.tokenId, parsed.secret);
  if (!ownerId) return null;
  const user = await users.get(c.env, ownerId);
  return { id: ownerId, email: user?.email ?? null, name: user?.name ?? null, via: "bearer" };
}

export async function resolveCaller(c: Context<AppEnv>, policy: Policy): Promise<Caller | null> {
  if (policy !== "bearer") {
    const caller = await fromSession(c);
    if (caller) return caller;
  }
  return policy === "session" ? null : fromBearer(c);
}

// Cookies ride along on cross-site form posts; a bearer header cannot. So only
// cookie-authenticated mutations need the Origin check (SameSite=Lax covers most
// of it, this closes the rest).
function sameOrigin(c: Context<AppEnv>): boolean {
  const origin = c.req.header("origin");
  if (!origin) return false;
  return origin === new URL(c.req.url).origin || origin === new URL(c.env.PUBLIC_BASE_URL).origin;
}

export const requireCaller = (policy: Policy, onMissing: "json" | "login" = "json") =>
  createMiddleware<AppEnv>(async (c, next) => {
    const caller = await resolveCaller(c, policy);
    if (!caller) {
      if (onMissing === "login") {
        const url = new URL(c.req.url);
        return c.redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
      }
      c.header("cache-control", "no-store");
      return c.json({ error: "Authentication required" }, 401);
    }
    if (caller.via === "session" && !SAFE.has(c.req.method) && !sameOrigin(c)) {
      return c.json({ error: "Forbidden — cross-origin request" }, 403);
    }
    c.set("caller", caller);
    await next();
  });
