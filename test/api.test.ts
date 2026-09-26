import { describe, expect, it } from "vitest";
import { BASE, call, person, publish } from "./helpers";

describe("authentication policy", () => {
  it("answers 401 JSON without credentials", async () => {
    const res = await call("/api/v1/onepagers");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Authentication required" });
  });

  it("rejects a malformed or unknown bearer", async () => {
    for (const auth of ["Bearer nope", "Bearer op_abc_def", "Basic x"]) {
      const res = await call("/api/v1/onepagers", { headers: { authorization: auth } });
      expect(res.status).toBe(401);
    }
  });

  it("does not accept a session cookie on bearer-only routes", async () => {
    const p = await person();
    expect((await call("/api/v1/onepagers", { as: p, via: "cookie" })).status).toBe(401);
  });

  it("does not accept a bearer on cookie-only routes", async () => {
    const p = await person();
    expect((await call("/api/v1/tokens", { as: p })).status).toBe(401);
  });

  it("refuses cookie-authenticated mutations from another origin", async () => {
    const p = await person();
    const res = await call("/api/v1/tokens", {
      method: "POST", as: p, via: "cookie", json: { name: "x" }, headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/onepagers", () => {
  it("creates a pager", async () => {
    const p = await person();
    const { res, body } = await publish(p);
    expect(res.status).toBe(201);
    expect(body).toEqual({ slug: body.slug, url: `${BASE}/p/${body.slug}`, version_number: 1, is_update: false, group_slug: null });
  });

  it("reports pydantic-style validation details", async () => {
    const p = await person();
    const res = await call("/api/v1/onepagers", { method: "POST", as: p, json: { html: "", filename: "  ", eyes_only: "maybe", slug: "Bad!" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Validation failed");
    expect(body.details.map((d: any) => [d.loc[0], d.type])).toEqual([
      ["html", "string_too_short"], ["filename", "string_too_short"], ["eyes_only", "bool_parsing"], ["slug", "value_error"],
    ]);
  });

  it("rejects a non-JSON body", async () => {
    const p = await person();
    const res = await call("/api/v1/onepagers", { method: "POST", as: p, body: "not json", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });

  it("enforces the HTML size cap", async () => {
    const p = await person();
    const res = await call("/api/v1/onepagers", { method: "POST", as: p, json: { html: "x".repeat(5_242_881), filename: "big.html" } });
    expect(res.status).toBe(413);
  });

  it("sanitises what it stores", async () => {
    const p = await person();
    const { body } = await publish(p, { html: '<base href="https://e.x/"><iframe src="https://e.x"></iframe><p>ok</p>' });
    const res = await call(`/api/v1/onepagers/${body.slug}/llm.txt`, { as: p });
    expect(await res.text()).toContain("ok");
    const page = await call(`/p/${body.slug}`, { as: p, via: "cookie" });
    expect(await page.text()).toBe("<p>ok</p>");
  });

  it("replays an Idempotency-Key instead of creating twice", async () => {
    const p = await person();
    const headers = { "idempotency-key": "key-1" };
    const first = await call("/api/v1/onepagers", { method: "POST", as: p, headers, json: { html: "<p>a</p>", filename: "a.html" } });
    const again = await call("/api/v1/onepagers", { method: "POST", as: p, headers, json: { html: "<p>a</p>", filename: "a.html" } });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    const list = (await (await call("/api/v1/onepagers", { as: p })).json()) as any;
    expect(list.onepagers).toHaveLength(1);
  });

  it("republishes for the owner and contributors only", async () => {
    const owner = await person("Own");
    const editor = await person("Ed");
    const viewer = await person("View");
    const { body } = await publish(owner);
    await call(`/api/v1/onepagers/${body.slug}/grants`, { method: "POST", as: owner, json: { email: editor.email, role: "contributor" } });
    await call(`/api/v1/onepagers/${body.slug}/grants`, { method: "POST", as: owner, json: { email: viewer.email } });

    const ok = await publish(editor, { slug: body.slug, html: "<p>v2</p>" });
    expect(ok.res.status).toBe(200);
    expect(ok.body).toEqual({ slug: body.slug, url: `${BASE}/p/${body.slug}`, version_number: 2, is_update: true });

    const denied = await publish(viewer, { slug: body.slug });
    expect(denied.res.status).toBe(403);
    expect(denied.body.error).toBe("Forbidden — you do not own or contribute to this OnePager");
    expect((await publish(owner, { slug: "zzzzzzzz" })).body).toEqual({ error: "OnePager 'zzzzzzzz' not found" });
  });

  it("files a new pager into a group the caller owns", async () => {
    const p = await person();
    const other = await person();
    await call("/api/v1/groups", { method: "POST", as: p, json: { group_slug: `team${p.id.slice(-6)}`, name: "Team" } });
    const slug = `team${p.id.slice(-6)}`;
    const { res, body } = await publish(p, { group_slug: slug });
    expect(res.status).toBe(201);
    expect(body.group_slug).toBe(slug);
    const group = (await (await call(`/api/v1/groups/${slug}`, { as: p })).json()) as any;
    expect(group.members).toEqual([body.slug]);

    expect((await publish(other, { group_slug: slug })).res.status).toBe(403);
    expect((await publish(p, { group_slug: "nosuchgroup" })).body).toEqual({ error: "Group 'nosuchgroup' not found" });
  });
});

describe("GET /api/v1/onepagers", () => {
  it("lists owned then shared pagers and searches content", async () => {
    const me = await person();
    const them = await person();
    const mine = await publish(me, { html: "<p>quarterly zebra</p>", title: "Report" });
    const theirs = await publish(them, { title: "Shared" });
    await call(`/api/v1/onepagers/${theirs.body.slug}/grants`, { method: "POST", as: them, json: { email: me.email } });

    const all = (await (await call("/api/v1/onepagers", { as: me })).json()) as any;
    expect(all.onepagers.map((r: any) => [r.slug, r.role])).toEqual([[mine.body.slug, "owner"], [theirs.body.slug, "viewer"]]);
    expect(Object.keys(all.onepagers[0]).sort()).toEqual([
      "comments_enabled", "content_sha256", "created_at", "eyes_only", "last_updated_at", "original_filename",
      "owner_oid", "role", "size_bytes", "slug", "title", "version_count",
    ]);

    const hit = (await (await call("/api/v1/onepagers?q=zebra", { as: me })).json()) as any;
    expect(hit.onepagers.map((r: any) => [r.slug, r.matched_content])).toEqual([[mine.body.slug, true]]);
  });
});

describe("versions and restore", () => {
  it("lists versions for contributors and restores for the owner only", async () => {
    const owner = await person();
    const editor = await person();
    const { body } = await publish(owner, { html: "<p>one</p>", title: "T1" });
    await publish(owner, { slug: body.slug, html: "<p>two</p>", title: "T2" });
    await call(`/api/v1/onepagers/${body.slug}/grants`, { method: "POST", as: owner, json: { email: editor.email, role: "contributor" } });

    const list = (await (await call(`/api/v1/onepagers/${body.slug}/versions`, { as: editor })).json()) as any;
    expect(list.versions.map((v: any) => v.version_number)).toEqual([2, 1]);
    expect(list.versions[0].published_at).toMatch(/\+00:00$/);
    expect(Object.keys(list.versions[0]).sort()).toEqual([
      "comments_enabled", "content_sha256", "original_filename", "published_at", "published_by_oid",
      "restored_from_version", "size_bytes", "title", "version_number",
    ]);

    const stranger = await person();
    const hidden = await call(`/api/v1/onepagers/${body.slug}/versions`, { as: stranger });
    expect(hidden.status).toBe(403);
    expect(await hidden.json()).toEqual({ error: "Forbidden — version history is for the owner or contributors" });

    const byEditor = await call(`/api/v1/onepagers/${body.slug}/versions/1/restore`, { method: "POST", as: editor });
    expect(await byEditor.json()).toEqual({ error: "Forbidden — only the owner can restore" });
    expect((await call(`/api/v1/onepagers/${body.slug}/versions/x/restore`, { method: "POST", as: owner })).status).toBe(400);
    const missing = await call(`/api/v1/onepagers/${body.slug}/versions/9/restore`, { method: "POST", as: owner });
    expect(await missing.json()).toEqual({ error: "OnePager version '9' not found" });

    const restored = await call(`/api/v1/onepagers/${body.slug}/versions/1/restore`, { method: "POST", as: owner });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ version_number: 3, restored_from_version: 1, title: "T1" });
  });
});

describe("grants", () => {
  it("is owner-only and validates input", async () => {
    const owner = await person();
    const other = await person();
    const { body } = await publish(owner);
    const path = `/api/v1/onepagers/${body.slug}/grants`;
    expect(await (await call(path, { method: "POST", as: other, json: { email: "a@b.c" } })).json())
      .toEqual({ error: "Forbidden — only the owner can share" });
    expect(await (await call(path, { method: "POST", as: owner, json: {} })).json()).toEqual({ error: "email is required" });
    expect(await (await call(path, { method: "POST", as: owner, json: { email: "a@b.c", role: "admin" } })).json())
      .toEqual({ error: "role must be one of viewer, contributor" });

    const made = await call(path, { method: "POST", as: owner, json: { email: "A@B.c", role: "contributor" } });
    expect(made.status).toBe(201);
    expect(await made.json()).toEqual({ slug: body.slug, email: "a@b.c", role: "contributor" });
    const list = (await (await call(path, { as: owner })).json()) as any;
    expect(list.grants.map((g: any) => [g.email, g.role])).toEqual([["a@b.c", "contributor"]]);
    expect(list.grants[0].granted_at).toMatch(/\+00:00$/);

    expect((await call(`${path}/a@b.c`, { method: "DELETE", as: owner })).status).toBe(204);
    expect(await (await call(`${path}/a@b.c`, { method: "DELETE", as: owner })).json()).toEqual({ error: "Grant 'a@b.c' not found" });
  });
});

describe("delete and llm.txt", () => {
  it("lets only the owner delete, by bearer or cookie", async () => {
    const owner = await person();
    const other = await person();
    const a = await publish(owner);
    const b = await publish(owner);
    const denied = await call(`/api/v1/onepagers/${a.body.slug}`, { method: "DELETE", as: other });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: "Forbidden" });
    expect((await call(`/api/v1/onepagers/${a.body.slug}`, { method: "DELETE", as: owner })).status).toBe(204);
    expect((await call(`/api/v1/onepagers/${b.body.slug}`, { method: "DELETE", as: owner, via: "cookie" })).status).toBe(204);
    expect((await call(`/api/v1/onepagers/${a.body.slug}`, { method: "DELETE", as: owner })).status).toBe(404);
  });

  it("serves markdown with a header block, hiding private pagers", async () => {
    const owner = await person();
    const other = await person();
    const { body } = await publish(owner, { html: "<h1>Plan</h1><p>ship it</p>", comments_enabled: true, eyes_only: true });
    const res = await call(`/api/v1/onepagers/${body.slug}/llm.txt`, { as: owner });
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    const text = await res.text();
    expect(text).toMatch(new RegExp(`^slug: ${body.slug}\\nurl: ${BASE}/p/${body.slug}\\nversion: 1\\nupdated: .+\\+00:00\\n---\\n# Plan\\n\\nship it\\n\\n## Comments\\n\\n_No comments yet._\\n$`));
    const hidden = await call(`/api/v1/onepagers/${body.slug}/llm.txt`, { as: other });
    expect(hidden.status).toBe(403);
    expect(await hidden.json()).toEqual({ error: "Forbidden — this OnePager is private" });
  });
});

describe("groups", () => {
  it("creates, lists, shows, manages members and deletes", async () => {
    const owner = await person();
    const other = await person();
    const slug = `g${owner.id.slice(-7)}`;
    const made = await call("/api/v1/groups", { method: "POST", as: owner, json: { group_slug: slug, name: "Crew" } });
    expect(made.status).toBe(201);
    expect(await made.json()).toEqual({ group_slug: slug, name: "Crew" });
    const dup = await call("/api/v1/groups", { method: "POST", as: other, json: { group_slug: slug, name: "X" } });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: `A group already exists at /g/${slug}` });

    const list = (await (await call("/api/v1/groups", { as: owner })).json()) as any;
    expect(list.groups.map((g: any) => g.group_slug)).toEqual([slug]);

    const mine = await publish(owner);
    const theirs = await publish(other);
    const add = await call(`/api/v1/groups/${slug}/members`, { method: "POST", as: owner, json: { pager_slug: mine.body.slug } });
    expect(add.status).toBe(201);
    expect(await add.json()).toEqual({ group_slug: slug, pager_slug: mine.body.slug });
    expect(await (await call(`/api/v1/groups/${slug}/members`, { method: "POST", as: owner, json: { pager_slug: theirs.body.slug } })).json())
      .toEqual({ error: "Forbidden — you can only add OnePagers you own" });
    expect(await (await call(`/api/v1/groups/${slug}/members`, { method: "POST", as: other, json: { pager_slug: theirs.body.slug } })).json())
      .toEqual({ error: "Forbidden — only the owner can manage this group" });

    const shown = (await (await call(`/api/v1/groups/${slug}`, { as: owner })).json()) as any;
    expect(shown).toMatchObject({ group_slug: slug, name: "Crew", members: [mine.body.slug] });
    expect((await call(`/api/v1/groups/${slug}/members/${mine.body.slug}`, { method: "DELETE", as: owner })).status).toBe(204);
    expect((await call(`/api/v1/groups/${slug}`, { method: "DELETE", as: owner })).status).toBe(204);
    expect(await (await call(`/api/v1/groups/${slug}`, { as: owner })).json()).toEqual({ error: `Group '${slug}' not found` });
  });
});

describe("tokens", () => {
  it("creates, lists and revokes via the session", async () => {
    const p = await person();
    const made = await call("/api/v1/tokens", { method: "POST", as: p, via: "cookie", json: { name: "ci" } });
    expect(made.status).toBe(201);
    const token = (await made.json()) as any;
    expect(Object.keys(token).sort()).toEqual(["created_at", "full_token", "name", "token_id"]);
    const list = (await (await call("/api/v1/tokens", { as: p, via: "cookie" })).json()) as any;
    expect(list.tokens.map((t: any) => t.name).sort()).toEqual(["ci", "test"]);
    expect(list.tokens[0]).not.toHaveProperty("full_token");
    expect((await call(`/api/v1/tokens/${token.token_id}`, { method: "DELETE", as: p, via: "cookie" })).status).toBe(204);
    expect(await (await call(`/api/v1/tokens/${token.token_id}`, { method: "DELETE", as: p, via: "cookie" })).json())
      .toEqual({ error: `Token '${token.token_id}' not found` });
    const revoked = await call("/api/v1/onepagers", { headers: { authorization: `Bearer ${token.full_token}` } });
    expect(revoked.status).toBe(401);
  });
});

describe("comments API", () => {
  it("posts, lists, resolves and deletes with author-or-owner rules", async () => {
    const owner = await person("Owner");
    const reader = await person("Reader");
    const { body } = await publish(owner, { comments_enabled: true });
    const path = `/p/${body.slug}/comments`;
    const made = await call(path, { method: "POST", as: reader, via: "cookie", json: { text: "nice", anchor_selector: "body > p", anchor_text_snippet: "world" } });
    expect(made.status).toBe(201);
    const c = (await made.json()) as any;
    expect(c).toMatchObject({ author_oid: reader.id, author_name: "Reader", parent_comment_id: null, resolved_at: null });

    const list = (await (await call(path, { as: owner, via: "cookie" })).json()) as any;
    expect(list.comments.map((x: any) => x.comment_id)).toEqual([c.comment_id]);

    const bystander = await person();
    expect((await call(`${path}/${c.comment_id}/resolve`, { method: "POST", as: bystander, via: "cookie" })).status).toBe(403);
    expect((await call(`${path}/${c.comment_id}/resolve`, { method: "POST", as: owner, via: "cookie" })).status).toBe(204);
    expect((await call(`${path}/${c.comment_id}`, { method: "DELETE", as: reader, via: "cookie" })).status).toBe(204);
    expect(await (await call(`${path}/${c.comment_id}`, { method: "DELETE", as: reader, via: "cookie" })).json())
      .toEqual({ error: `Comment '${c.comment_id}' not found` });
  });

  it("is 404 when comments are off or the pager is private to the caller", async () => {
    const owner = await person();
    const other = await person();
    const off = await publish(owner);
    const priv = await publish(owner, { comments_enabled: true, eyes_only: true });
    expect(await (await call(`/p/${off.body.slug}/comments`, { as: owner, via: "cookie" })).json())
      .toEqual({ error: `OnePager '${off.body.slug}' not found` });
    expect((await call(`/p/${priv.body.slug}/comments`, { as: other, via: "cookie" })).status).toBe(404);
  });
});

describe("dashboard JSON endpoints", () => {
  it("lists viewers other than the owner and deletes via cookie", async () => {
    const owner = await person();
    const reader = await person();
    const { body } = await publish(owner);
    await call(`/p/${body.slug}`, { as: reader, via: "cookie" });
    await call(`/p/${body.slug}`, { as: reader, via: "cookie" });
    await call(`/p/${body.slug}`, { as: owner, via: "cookie" });
    const res = (await (await call(`/me/onepagers/${body.slug}/viewers`, { as: owner, via: "cookie" })).json()) as any;
    expect(res.slug).toBe(body.slug);
    expect(res.viewers).toEqual([{ email: reader.email, views: 2, last_viewed: expect.stringMatching(/\+00:00$/) }]);
    expect((await call(`/me/onepagers/${body.slug}/viewers`, { as: reader, via: "cookie" })).status).toBe(403);
    expect((await call(`/me/onepagers/${body.slug}`, { method: "DELETE", as: owner, via: "cookie" })).status).toBe(204);
  });
});
