import { decodeIdToken, generateCodeVerifier, generateState, GitHub, Google } from "arctic";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Bindings } from "../env";
import { track } from "../lib/analytics";
import { page } from "../lib/render";
import { Login } from "../views/login";
import { SESSION_COOKIE } from "./middleware";
import * as users from "./users";

type Provider = "github" | "google";
const FLOW_MAX_AGE_S = 600;

export function configured(env: Bindings): Provider[] {
  const out: Provider[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push("github");
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push("google");
  return out;
}

/** Only same-site paths; `//host` and `/\host` are protocol-relative in browsers. */
export function safeNext(raw: string | undefined | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/me";
  return raw;
}

const redirectUri = (env: Bindings, p: Provider) => `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/auth/${p}/callback`;
const secure = (c: Context) => new URL(c.req.url).protocol === "https:";

interface Identity {
  id: string;
  email: string | null;
  name: string | null;
}

async function githubIdentity(accessToken: string): Promise<Identity> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "onepager" };
  const [userRes, emailsRes] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);
  if (!userRes.ok) throw new Error(`GitHub /user answered ${userRes.status}`);
  const user = (await userRes.json()) as { id: number; login: string; name: string | null };
  // Only the verified primary address: a public profile email is self-asserted.
  const emails = emailsRes.ok ? ((await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[]) : [];
  const primary = emails.find((e) => e.primary && e.verified);
  return { id: `github:${user.id}`, email: primary?.email ?? null, name: user.name || user.login };
}

function googleIdentity(idToken: string): Identity {
  // Received directly from Google's token endpoint over TLS, so the claims need no
  // signature check (OIDC Core 3.1.3.7).
  const claims = decodeIdToken(idToken) as { sub: string; email?: string; email_verified?: boolean; name?: string };
  return {
    id: `google:${claims.sub}`,
    email: claims.email && claims.email_verified ? claims.email : null,
    name: claims.name ?? null,
  };
}

export const auth = new Hono<AppEnv>();

auth.get("/login", (c) =>
  page(c, <Login next={safeNext(c.req.query("next"))} providers={configured(c.env)} />, 200, { "cache-control": "no-store" }),
);

auth.get("/auth/:provider", (c) => {
  const p = c.req.param("provider") as Provider;
  if (!configured(c.env).includes(p)) return c.json({ error: `Provider '${p}' not found` }, 404);
  const state = generateState();
  const opts = { path: "/auth", httpOnly: true, secure: secure(c), sameSite: "Lax" as const, maxAge: FLOW_MAX_AGE_S };
  setCookie(c, "oauth_state", state, opts);
  setCookie(c, "oauth_next", safeNext(c.req.query("next")), opts);
  let url: URL;
  if (p === "github") {
    url = new GitHub(c.env.GITHUB_CLIENT_ID!, c.env.GITHUB_CLIENT_SECRET!, redirectUri(c.env, p)).createAuthorizationURL(state, [
      "read:user",
      "user:email",
    ]);
  } else {
    const verifier = generateCodeVerifier();
    setCookie(c, "oauth_verifier", verifier, opts);
    url = new Google(c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, redirectUri(c.env, p)).createAuthorizationURL(
      state,
      verifier,
      ["openid", "email", "profile"],
    );
  }
  return c.redirect(url.toString(), 302);
});

auth.get("/auth/:provider/callback", async (c) => {
  const p = c.req.param("provider") as Provider;
  if (!configured(c.env).includes(p)) return c.json({ error: `Provider '${p}' not found` }, 404);
  const expected = getCookie(c, "oauth_state");
  const verifier = getCookie(c, "oauth_verifier");
  const next = safeNext(getCookie(c, "oauth_next"));
  for (const name of ["oauth_state", "oauth_verifier", "oauth_next"]) deleteCookie(c, name, { path: "/auth" });

  const code = c.req.query("code");
  const state = c.req.query("state");
  const fail = (msg: string) =>
    page(c, <Login next={next} providers={configured(c.env)} error={msg} />, 400, { "cache-control": "no-store" });
  if (!code || !state || !expected || state !== expected) return fail("That sign-in link expired or was tampered with. Try again.");

  let who: Identity;
  try {
    if (p === "github") {
      const tokens = await new GitHub(c.env.GITHUB_CLIENT_ID!, c.env.GITHUB_CLIENT_SECRET!, redirectUri(c.env, p)).validateAuthorizationCode(code);
      who = await githubIdentity(tokens.accessToken());
    } else {
      if (!verifier) return fail("That sign-in link expired. Try again.");
      const tokens = await new Google(c.env.GOOGLE_CLIENT_ID!, c.env.GOOGLE_CLIENT_SECRET!, redirectUri(c.env, p)).validateAuthorizationCode(code, verifier);
      who = googleIdentity(tokens.idToken());
    }
  } catch (err) {
    console.error(`OAuth ${p} callback failed`, err);
    return fail("Sign-in with the provider failed. Try again.");
  }

  await users.upsert(c.env, { id: who.id, provider: p, email: who.email, name: who.name });
  const session = await users.createSession(c.env, who.id);
  setCookie(c, SESSION_COOKIE, session, {
    path: "/", httpOnly: true, secure: secure(c), sameSite: "Lax", maxAge: users.SESSION_MAX_AGE_S,
  });
  c.set("caller", { ...who, via: "session" });
  track(c, "Signed In", { provider: p });
  return c.redirect(next, 302);
});

auth.post("/logout", async (c) => {
  // A cross-site POST could only sign someone out; still, keep it same-origin.
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Forbidden — cross-origin request" }, 403);
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) await users.endSession(c.env, cookie);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/login", 302);
});
