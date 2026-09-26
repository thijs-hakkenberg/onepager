import { describe, expect, it } from "vitest";
import { call, person, publish } from "./helpers";

const page = (path: string, as: Awaited<ReturnType<typeof person>>) => call(path, { as, via: "cookie" });

describe("viewer", () => {
  it("serves author HTML sandboxed without same-origin", async () => {
    const p = await person();
    const { body } = await publish(p, { html: "<p>hi</p><script>1</script>" });
    const res = await page(`/p/${body.slug}`, p);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts[^;]*; frame-ancestors 'none'$/);
    expect(res.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    // The owner's view ends with their visibility pill; anyone else gets the bytes as stored.
    expect(await res.text()).toMatch(/^<p>hi<\/p><script>1<\/script><link rel="stylesheet" href="\/visibility.css">/);
    expect(await (await page(`/p/${body.slug}`, await person())).text()).toBe("<p>hi</p><script>1</script>");
    expect((await page(`/p/${body.slug}/raw`, p)).status).toBe(404);
  });

  it("wraps comment-enabled pagers and frames /raw with the shim", async () => {
    const p = await person();
    const { body } = await publish(p, { comments_enabled: true, title: "Deck" });
    const wrap = await page(`/p/${body.slug}`, p);
    expect(wrap.headers.get("content-security-policy")).toContain("script-src 'self'");
    const html = await wrap.text();
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain(`src="/p/${body.slug}/raw"`);
    expect(html).toContain('sandbox="allow-scripts');
    expect(html).toContain('src="/comments.js"');

    const raw = await page(`/p/${body.slug}/raw`, p);
    expect(raw.headers.get("content-security-policy")).toMatch(/frame-ancestors 'self'$/);
    const text = await raw.text();
    expect(text.startsWith("<h1>Hello</h1>")).toBe(true);
    for (const t of ["onepager:anchor", "onepager:lost-anchors", "onepager:focus", "onepager:counts"]) expect(text).toContain(t);
  });

  it("serves historical versions and 404s bad ones", async () => {
    const p = await person();
    const { body } = await publish(p, { html: "<p>one</p>", comments_enabled: true });
    await publish(p, { slug: body.slug, html: "<p>two</p>" });
    const v1 = await page(`/p/${body.slug}/v/1`, p);
    expect(await v1.text()).toBe("<p>one</p>");
    expect(v1.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    for (const n of ["3", "0", "1x"]) expect((await page(`/p/${body.slug}/v/${n}`, p)).status).toBe(404);
  });

  it("renders branded 404 and 403 pages", async () => {
    const owner = await person();
    const other = await person();
    const missing = await page("/p/zzzzzzzz", owner);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(await missing.text()).toContain("NoPager");
    const { body } = await publish(owner, { eyes_only: true });
    const denied = await page(`/p/${body.slug}`, other);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("This OnePager is private.");
    expect((await page(`/p/${body.slug}/v/1`, other)).status).toBe(403);
  });

  it("does not accept a bearer token for pages", async () => {
    const p = await person();
    const { body } = await publish(p);
    const res = await call(`/p/${body.slug}`, { as: p });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/login?next=%2Fp%2F${body.slug}`);
  });
});

describe("dashboard", () => {
  it("lists, searches and filters by group", async () => {
    const p = await person();
    const a = await publish(p, { title: "Alpha", html: "<p>needle</p>" });
    const b = await publish(p, { title: "Beta" });
    const g = `d${p.id.slice(-7)}`;
    await call("/api/v1/groups", { method: "POST", as: p, json: { group_slug: g, name: "Dgroup" } });
    await call(`/api/v1/groups/${g}/members`, { method: "POST", as: p, json: { pager_slug: b.body.slug } });

    const all = await (await page("/me", p)).text();
    expect(all).toContain("Alpha");
    expect(all).toContain("Beta");
    expect(all).toContain(`href="/g/${g}"`);

    const hit = await (await page("/me?q=needle", p)).text();
    expect(hit).toContain(a.body.slug);
    expect(hit).not.toContain(b.body.slug);
    expect(hit).toContain("content match");

    const grouped = await (await page(`/me?group=${g}`, p)).text();
    expect(grouped).toContain(b.body.slug);
    expect(grouped).not.toContain(`row-${a.body.slug}`);
  });

  it("escapes author-controlled titles", async () => {
    const p = await person();
    await publish(p, { title: "<img src=x onerror=alert(1)>" });
    const html = await (await page("/me", p)).text();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

describe("gallery", () => {
  it("shows only members the caller may view", async () => {
    const owner = await person();
    const other = await person();
    const g = `h${owner.id.slice(-7)}`;
    await call("/api/v1/groups", { method: "POST", as: owner, json: { group_slug: g, name: "Showcase" } });
    const open = await publish(owner, { title: "Open one", group_slug: g });
    const hidden = await publish(owner, { title: "Hidden one", group_slug: g, eyes_only: true });

    const res = await page(`/g/${g}`, other);
    expect(res.headers.get("cache-control")).toBe("private, max-age=30");
    const html = await res.text();
    expect(html).toContain(open.body.slug);
    expect(html).not.toContain(hidden.body.slug);
    expect(await (await page(`/g/${g}`, owner)).text()).toContain(hidden.body.slug);
    expect((await page("/g/nosuchgroup", owner)).status).toBe(404);
  });
});

describe("tokens page", () => {
  it("lists the caller's tokens", async () => {
    const p = await person();
    const res = await page("/settings/tokens", p);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Plugin tokens");
    expect(html).toContain('src="/tokens.js"');
    expect(html).toMatch(/<code>[A-Za-z0-9]{12}<\/code>/);
  });
});

describe("visibility", () => {
  const anon = (path: string) => call(path);

  it("public pages need no sign-in, and only the owner sees the banner", async () => {
    const owner = await person();
    const other = await person();
    const { res, body } = await publish(owner, { html: "<p>open</p>", visibility: "public" });
    expect(body.visibility).toBe("public");
    expect(res.status).toBe(201);

    const bare = await anon(`/p/${body.slug}`);
    expect(bare.status).toBe(200);
    expect(await bare.text()).toBe("<p>open</p>");
    expect((await anon(`/api/v1/onepagers/${body.slug}/llm.txt`)).status).toBe(200);

    const mine = await (await page(`/p/${body.slug}`, owner)).text();
    expect(mine.startsWith("<p>open</p>")).toBe(true);
    expect(mine).toContain('class="onepager-vis onepager-vis-public"');
    expect(await (await page(`/p/${body.slug}`, other)).text()).toBe("<p>open</p>");
  });

  it("puts the owner's pill in the comments wrapper, for every level", async () => {
    const owner = await person();
    const { body } = await publish(owner, { comments_enabled: true, eyes_only: true });
    const html = await (await page(`/p/${body.slug}`, owner)).text();
    expect(html).toContain("onepager-vis-private");
    expect(html).toContain('id="comments-toggle"');
  });

  it("lets only the owner change visibility in place, without a new version", async () => {
    const owner = await person();
    const other = await person();
    const { body } = await publish(owner);
    expect((await anon(`/p/${body.slug}`)).status).toBe(302);

    const patch = (as: typeof owner, visibility: unknown, via: "bearer" | "cookie" = "bearer") =>
      call(`/api/v1/onepagers/${body.slug}`, { method: "PATCH", as, via, json: { visibility } });
    expect((await patch(other, "public")).status).toBe(403);
    const bad = await patch(owner, "everyone");
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).details[0].loc).toEqual(["visibility"]);

    const ok = await patch(owner, "public", "cookie");
    expect(await ok.json()).toEqual({ slug: body.slug, visibility: "public" });
    expect((await anon(`/p/${body.slug}`)).status).toBe(200);

    expect((await patch(owner, "private")).status).toBe(200);
    expect((await anon(`/p/${body.slug}`)).status).toBe(302);
    expect((await page(`/p/${body.slug}`, other)).status).toBe(403);

    const list = (await (await call("/api/v1/onepagers", { as: owner })).json()) as any;
    expect(list.onepagers[0]).toMatchObject({ slug: body.slug, visibility: "private", eyes_only: true, version_count: 1 });
  });

  it("maps the legacy eyes_only flag, and a republish keeps visibility unless told otherwise", async () => {
    const owner = await person();
    const { body } = await publish(owner, { visibility: "public" });
    const again = await publish(owner, { slug: body.slug, html: "<p>v2</p>" });
    expect(again.body.visibility).toBe("public");
    const legacy = await publish(owner, { slug: body.slug, eyes_only: false });
    expect(legacy.body.visibility).toBe("signed_in");
    const both = await publish(owner, { slug: body.slug, eyes_only: true, visibility: "public" });
    expect(both.body.visibility).toBe("public");
  });
});
