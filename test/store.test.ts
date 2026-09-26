import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as pagers from "../src/domain/pagers";
import * as grants from "../src/domain/grants";
import * as tokens from "../src/domain/tokens";
import * as groups from "../src/domain/groups";
import * as comments from "../src/domain/comments";
import * as views from "../src/domain/views";
import * as idem from "../src/domain/idempotency";
import * as users from "../src/auth/users";

let seq = 0;
const who = () => ({ id: `github:${++seq}${Math.random().toString(36).slice(2, 6)}`, email: null, name: "Ann" });
const doc = (s: string) => `<h1>${s}</h1><p>body of ${s}</p>`;

describe("pagers", () => {
  it("publishes version 1 with a filename-derived title and stores the blob", async () => {
    const owner = who();
    const { slug, version_number } = await pagers.publish(env, owner, {
      html: doc("Alpha"), filename: "dir/deck.final.html", title: null, comments_enabled: null, eyes_only: null,
    });
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
    expect(version_number).toBe(1);
    const meta = (await pagers.get(env, slug))!;
    expect(meta).toMatchObject({
      owner_id: owner.id, title: "deck.final", original_filename: "dir/deck.final.html",
      comments_enabled: false, eyes_only: false, version_count: 1, size_bytes: doc("Alpha").length,
    });
    expect(meta.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.search_text).toBe("# alpha body of alpha");
    expect(await pagers.html(env, slug)).toBe(doc("Alpha"));
  });

  it("republishes as a new version, keeping options that were not sent", async () => {
    const owner = who();
    const { slug } = await pagers.publish(env, owner, {
      html: doc("One"), filename: "a.html", title: "Named", comments_enabled: true, eyes_only: true,
    });
    const meta = (await pagers.get(env, slug))!;
    const out = await pagers.republish(env, meta, owner, {
      html: doc("Two"), filename: "b.html", title: null, comments_enabled: null, eyes_only: null,
    });
    expect(out.version_number).toBe(2);
    const after = (await pagers.get(env, slug))!;
    expect(after).toMatchObject({ title: "Named", original_filename: "b.html", comments_enabled: true, eyes_only: true, version_count: 2 });
    expect(after.last_updated_at).not.toBeNull();
    expect(await pagers.html(env, slug)).toBe(doc("Two"));
    expect(await pagers.html(env, slug, 1)).toBe(doc("One"));
    const vs = await pagers.versions(env, slug);
    expect(vs.map((v) => v.version_number)).toEqual([2, 1]);
  });

  it("restores an old version as a new one and keeps the live eyes_only", async () => {
    const owner = who();
    const { slug } = await pagers.publish(env, owner, {
      html: doc("Old"), filename: "old.html", title: "Old", comments_enabled: false, eyes_only: false,
    });
    await pagers.republish(env, (await pagers.get(env, slug))!, owner, {
      html: doc("New"), filename: "new.html", title: "New", comments_enabled: true, eyes_only: true,
    });
    const restored = await pagers.restore(env, (await pagers.get(env, slug))!, owner, 1);
    expect(restored).toMatchObject({ version_number: 3, restored_from_version: 1, title: "Old", comments_enabled: false });
    const meta = (await pagers.get(env, slug))!;
    expect(meta).toMatchObject({ version_count: 3, title: "Old", eyes_only: true, comments_enabled: false });
    expect(await pagers.html(env, slug)).toBe(doc("Old"));
    expect(await pagers.restore(env, meta, owner, 9)).toBeNull();
  });

  it("deletes every row and blob that belongs to a pager", async () => {
    const owner = who();
    const { slug } = await pagers.publish(env, owner, {
      html: doc("Gone"), filename: "g.html", title: null, comments_enabled: true, eyes_only: null,
    });
    await pagers.republish(env, (await pagers.get(env, slug))!, owner, {
      html: doc("Gone2"), filename: "g.html", title: null, comments_enabled: null, eyes_only: null,
    });
    await grants.put(env, slug, "X@Y.test", "viewer", owner.id);
    await views.record(env, slug, "github:v");
    await comments.post(env, slug, owner, { text: "t", anchor_selector: "body", anchor_text_snippet: "s", parent_comment_id: null });
    await groups.create(env, owner.id, `grp${seq}`, "G");
    await groups.addMember(env, `grp${seq}`, slug);

    expect(await pagers.remove(env, slug)).toBe(true);
    expect(await pagers.get(env, slug)).toBeNull();
    for (const table of ["versions", "grants", "views", "comments"]) {
      const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE slug = ?`).bind(slug).first<{ n: number }>();
      expect(row!.n, table).toBe(0);
    }
    expect(await groups.members(env, `grp${seq}`)).toEqual([]);
    expect((await env.BUCKET.list({ prefix: `${slug}/` })).objects).toEqual([]);
    expect(await pagers.remove(env, slug)).toBe(false);
  });

  it("lists owned pagers then shared ones, and filters by search terms", async () => {
    const owner = who();
    const other = who();
    const mine = await pagers.publish(env, owner, { html: doc("Zebra facts"), filename: "z.html", title: "Mine", comments_enabled: null, eyes_only: null });
    const theirs = await pagers.publish(env, other, { html: doc("Other"), filename: "o.html", title: "Theirs", comments_enabled: null, eyes_only: null });
    await grants.put(env, theirs.slug, "me@x.test", "contributor", other.id);

    const all = await pagers.listFor(env, owner, "me@x.test", null);
    expect(all.map((r) => [r.slug, r.role])).toEqual([[mine.slug, "owner"], [theirs.slug, "contributor"]]);
    expect(all[0]).not.toHaveProperty("matched_content");
    expect(all[0].created_at.endsWith("Z")).toBe(true);
    expect(all[0].last_updated_at).toBe(all[0].created_at);

    const hits = await pagers.listFor(env, owner, "me@x.test", "zebra");
    expect(hits.map((r) => [r.slug, r.matched_content])).toEqual([[mine.slug, true]]);
    const byTitle = await pagers.listFor(env, owner, "me@x.test", "MINE");
    expect(byTitle.map((r) => r.matched_content)).toEqual([false]);
  });
});

describe("grants", () => {
  it("upserts lowercase emails and resolves roles", async () => {
    await grants.put(env, "gslug001", "Bob@X.test", "viewer", "github:o");
    await grants.put(env, "gslug001", "bob@x.test", "contributor", "github:o");
    expect(await grants.roleFor(env, "gslug001", "BOB@x.test")).toBe("contributor");
    const list = await grants.list(env, "gslug001");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: "bob@x.test", role: "contributor" });
    expect(await grants.remove(env, "gslug001", "BOB@x.test")).toBe(true);
    expect(await grants.remove(env, "gslug001", "bob@x.test")).toBe(false);
  });
});

describe("tokens", () => {
  it("verifies only the matching secret and stamps last_used_at", async () => {
    const owner = who();
    const minted = await tokens.create(env, owner.id, "laptop");
    expect(minted.full.startsWith(`op_${minted.token_id}_`)).toBe(true);
    const [, id, secret] = minted.full.split("_");
    expect(await tokens.verify(env, id, secret + "x")).toBeNull();
    expect(await tokens.verify(env, id, secret)).toBe(owner.id);
    const [listed] = await tokens.list(env, owner.id);
    expect(listed.last_used_at).not.toBeNull();
    expect(await tokens.remove(env, owner.id, id)).toBe(true);
    expect(await tokens.verify(env, id, secret)).toBeNull();
    expect(await tokens.remove(env, owner.id, id)).toBe(false);
  });
});

describe("groups", () => {
  it("rejects a duplicate slug and tracks members", async () => {
    const owner = who();
    expect(await groups.create(env, owner.id, "team01", "Team")).toMatchObject({ group_slug: "team01", name: "Team" });
    expect(await groups.create(env, owner.id, "team01", "Again")).toBeNull();
    await groups.addMember(env, "team01", "pagerabc");
    await groups.addMember(env, "team01", "pagerabc");
    expect(await groups.members(env, "team01")).toEqual(["pagerabc"]);
    expect((await groups.listFor(env, owner.id)).map((g) => g.group_slug)).toEqual(["team01"]);
    expect(await groups.removeMember(env, "team01", "pagerabc")).toBe(true);
    expect(await groups.remove(env, "team01")).toBe(true);
    expect(await groups.get(env, "team01")).toBeNull();
  });
});

describe("comments", () => {
  it("posts, lists, resolves and deletes", async () => {
    const author = who();
    const c = await comments.post(env, "cslug001", author, {
      text: "hi", anchor_selector: "body > p", anchor_text_snippet: "p", parent_comment_id: null,
    });
    expect(c.comment_id).toMatch(/^[a-z0-9]{12}$/);
    expect(c.author_name).toBe("Ann");
    expect(await comments.list(env, "cslug001")).toHaveLength(1);
    expect(await comments.resolve(env, "cslug001", c.comment_id)).toBe(true);
    expect((await comments.get(env, "cslug001", c.comment_id))!.resolved_at).not.toBeNull();
    expect(await comments.remove(env, "cslug001", c.comment_id)).toBe(true);
    expect(await comments.get(env, "cslug001", c.comment_id)).toBeNull();
  });
});

describe("views and idempotency", () => {
  it("counts repeat views", async () => {
    await views.record(env, "vslug001", "github:a");
    await views.record(env, "vslug001", "github:a");
    const row = await env.DB.prepare("SELECT view_count FROM views WHERE slug = ?").bind("vslug001").first<{ view_count: number }>();
    expect(row!.view_count).toBe(2);
  });

  it("replays a stored response for the same owner and key only", async () => {
    await idem.save(env, "github:i", "k1", 201, { slug: "abc" });
    expect(await idem.lookup(env, "github:i", "k1")).toEqual({ status: 201, body: { slug: "abc" } });
    expect(await idem.lookup(env, "github:other", "k1")).toBeNull();
  });
});

describe("users and sessions", () => {
  it("upserts users and resolves live sessions only", async () => {
    await users.upsert(env, { id: "github:77", provider: "github", email: "A@B.test", name: "A" });
    await users.upsert(env, { id: "github:77", provider: "github", email: "a@b.test", name: "A2" });
    const cookie = await users.createSession(env, "github:77");
    expect(await users.sessionUser(env, cookie)).toMatchObject({ id: "github:77", email: "a@b.test", name: "A2" });
    expect(await users.sessionUser(env, cookie + "x")).toBeNull();
    await env.DB.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00Z'").run();
    expect(await users.sessionUser(env, cookie)).toBeNull();
    const fresh = await users.createSession(env, "github:77");
    await users.endSession(env, fresh);
    expect(await users.sessionUser(env, fresh)).toBeNull();
  });
});
