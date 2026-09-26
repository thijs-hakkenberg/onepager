import { createExecutionContext, env, SELF } from "cloudflare:test";
import { app } from "../src/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASE, call, person, publish } from "./helpers";

const get = (path: string, cookie = "") =>
  SELF.fetch(BASE + path, { redirect: "manual", headers: cookie ? { cookie } : {} });

const cookieValue = (res: Response, name: string) => {
  for (const line of res.headers.getSetCookie()) {
    const m = line.match(new RegExp(`^${name}=([^;]*)`));
    if (m) return m[1];
  }
  return null;
};

async function begin(provider: string, next = "") {
  const res = await get(`/auth/${provider}${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  expect(res.status).toBe(302);
  const url = new URL(res.headers.get("location")!);
  const jar = res.headers.getSetCookie().map((l) => l.split(";")[0]).join("; ");
  return { url, state: url.searchParams.get("state")!, jar };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

afterEach(() => vi.restoreAllMocks());

describe("sign-in", () => {
  it("sends anonymous page visits to /login with next", async () => {
    const res = await get("/me?q=x");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?next=%2Fme%3Fq%3Dx");
  });

  it("renders a login page offering configured providers", async () => {
    const res = await get("/login?next=/p/abc");
    const html = await res.text();
    expect(html).toContain('href="/auth/github?next=%2Fp%2Fabc"');
    expect(html).toContain('href="/auth/google?next=%2Fp%2Fabc"');
  });

  it("redirects to the provider with state and PKCE", async () => {
    const gh = await begin("github");
    expect(gh.url.origin + gh.url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(gh.url.searchParams.get("redirect_uri")).toBe(`${BASE}/auth/github/callback`);
    expect(gh.jar).toContain("oauth_state=");
    const g = await begin("google");
    expect(g.url.hostname).toBe("accounts.google.com");
    expect(g.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect((await get("/auth/myspace")).status).toBe(404);
  });

  it("rejects a callback whose state does not match", async () => {
    const { jar } = await begin("github");
    const res = await get("/auth/github/callback?code=c&state=wrong", jar);
    expect(res.status).toBe(400);
    expect(cookieValue(res, "op_session")).toBeNull();
  });

  it("signs in with GitHub using the verified primary email", async () => {
    const { state, jar } = await begin("github", "/settings/tokens");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://github.com/login/oauth/access_token"))
        return json({ access_token: "gho_x", token_type: "bearer", scope: "read:user,user:email" });
      if (url === "https://api.github.com/user") return json({ id: 4242, login: "octo", name: "Octo Cat" });
      if (url === "https://api.github.com/user/emails")
        return json([
          { email: "old@x.test", primary: false, verified: true },
          { email: "Octo@X.test", primary: true, verified: true },
        ]);
      throw new Error(`unexpected fetch ${url}`);
    });
    const res = await get(`/auth/github/callback?code=abc&state=${state}`, jar);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings/tokens");
    const session = cookieValue(res, "op_session")!;
    expect(session).toMatch(/^[A-Za-z0-9]{43}$/);
    vi.restoreAllMocks();

    const me = await get("/me", `op_session=${session}`);
    expect(me.status).toBe(200);
    expect(await me.text()).toContain("octo@x.test");
  });

  it("signs in with Google, dropping an unverified email", async () => {
    const { state, jar } = await begin("google");
    const idToken = `${b64url({ alg: "RS256" })}.${b64url({ sub: "g-77", email: "who@x.test", email_verified: false, name: "Who" })}.sig`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://oauth2.googleapis.com/token")
        return json({ access_token: "ya29", token_type: "Bearer", expires_in: 3600, id_token: idToken });
      throw new Error(`unexpected fetch ${url}`);
    });
    const res = await get(`/auth/google/callback?code=abc&state=${state}`, jar);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/me");
    vi.restoreAllMocks();
    const me = await get("/me", `op_session=${cookieValue(res, "op_session")}`);
    const html = await me.text();
    expect(html).toContain("Who");
    expect(html).not.toContain("who@x.test");
  });

  it("never redirects off-site after sign-in", async () => {
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const { jar } = await begin("github", next);
      expect(jar).not.toContain("evil");
    }
  });

  it("signs out, ending the session", async () => {
    const p = await person();
    const out = await call("/logout", { method: "POST", as: p, via: "cookie" });
    expect(out.status).toBe(302);
    expect((await call("/api/v1/tokens", { as: p, via: "cookie" })).status).toBe(401);
  });
});

describe("chrome", () => {
  it("serves health and the root redirect anonymously", async () => {
    expect(await (await get("/health")).json()).toEqual({ status: "ok" });
    expect((await get("/")).headers.get("location")).toBe("/me");
  });

  it("serves the launch page at / to anonymous visitors, unless it is eyes-only", async () => {
    const p = await person();
    const open = await publish(p, { html: "<h1>Welcome</h1>" });
    const hidden = await publish(p, { eyes_only: true });
    const root = (slug: string) =>
      app.fetch(new Request(`${BASE}/`), { ...env, LAUNCH_SLUG: slug }, createExecutionContext());
    const res = await root(open.body.slug);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Welcome</h1>");
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts[^;]*; frame-ancestors 'none'$/);
    expect((await root(hidden.body.slug)).headers.get("location")).toBe("/me");
    expect((await root("nosuchpage")).headers.get("location")).toBe("/me");
  });

  it("lets anyone read PUBLIC_SLUGS pages and their llm.txt, but nothing else", async () => {
    const p = await person();
    const open = await publish(p, { html: "<h1>Skill</h1>", comments_enabled: true });
    const other = await publish(p, { html: "<h1>Other</h1>" });
    const hidden = await publish(p, { eyes_only: true });
    const pub = { ...env, PUBLIC_SLUGS: ` ${open.body.slug}, ${hidden.body.slug}` };
    const fetch = (path: string, headers: Record<string, string> = {}) =>
      app.fetch(new Request(BASE + path, { headers }), pub, createExecutionContext());

    const page = await fetch(`/p/${open.body.slug}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("<h1>Skill</h1>");
    expect(page.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts[^;]*; frame-ancestors 'none'$/);
    const llm = await fetch(`/api/v1/onepagers/${open.body.slug}/llm.txt`);
    expect(llm.status).toBe(200);
    expect(await llm.text()).toContain("# Skill");

    for (const slug of [other.body.slug, hidden.body.slug, "nosuchpage"]) {
      expect((await fetch(`/p/${slug}`)).headers.get("location")).toMatch(/^\/login/);
      const denied = await fetch(`/api/v1/onepagers/${slug}/llm.txt`);
      expect(denied.status).toBe(401);
      expect(denied.headers.get("cache-control")).toBe("no-store");
    }
    // Signed in, the page is the normal wrapped view.
    const wrapped = await fetch(`/p/${open.body.slug}`, { cookie: `op_session=${p.cookie}` });
    expect(await wrapped.text()).toContain(`src="/p/${open.body.slug}/raw"`);
  });
});
