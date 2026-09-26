import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { requireCaller, resolveCaller } from "../auth/middleware";
import { canView, isOwner, isPublic } from "../domain/access";
import * as comments from "../domain/comments";
import * as grants from "../domain/grants";
import * as groups from "../domain/groups";
import * as pagers from "../domain/pagers";
import * as tokens from "../domain/tokens";
import * as views from "../domain/views";
import type { AppEnv, Caller } from "../env";
import { SELECTION_SHIM } from "../html/shim";
import { visibilityBadge } from "../html/visibility_badge";
import { track } from "../lib/analytics";
import { forbidden, jsonBody, noContent, notFound, validationFailed } from "../lib/http";
import { validate } from "../lib/params";
import { page } from "../lib/render";
import { iso8601 } from "../lib/time";
import { Dashboard } from "../views/dashboard";
import { NoGroup, NoPager, Private } from "../views/errors";
import { Gallery } from "../views/gallery";
import { Tokens } from "../views/tokens";
import { Wrapper } from "../views/wrapper";

// Author HTML runs in an opaque origin: `sandbox allow-scripts` without
// `allow-same-origin`, so its scripts can neither read our cookie nor call our API
// as the viewer.
const SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals";
const hardened = (ancestors: string) => ({
  "content-security-policy": `${SANDBOX}; frame-ancestors ${ancestors}`,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "private, max-age=60",
});

export const pages = new Hono<AppEnv>();
const browser = requireCaller("session", "login");
const session = requireCaller("session");

const noPager = (c: Context, slug: string) => page(c, <NoPager slug={slug} />, 404, { "cache-control": "no-store" });

/** Metadata, then the eyes-only guard, then (in the caller) the blob. */
async function viewable(c: Context<AppEnv>, slug: string): Promise<pagers.PagerMeta | Response> {
  const meta = await pagers.get(c.env, slug);
  if (!meta) return noPager(c, slug);
  const caller = c.var.caller;
  if (!(await canView(meta, caller, caller.email, grants.lookup(c.env)))) return page(c, <Private slug={slug} />, 403);
  return meta;
}

function recordView(c: Context<AppEnv>, slug: string) {
  const write = views.record(c.env, slug, c.var.caller.id).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(write);
  } catch {
    return write;
  }
}

/** A public page's HTML, served to anyone; null when the slug is not public. */
async function publicPage(c: Context<AppEnv>, slug: string | undefined): Promise<Response | null> {
  const meta = slug ? await pagers.get(c.env, slug) : null;
  if (!meta || !isPublic(c.env, meta)) return null;
  const html = await pagers.html(c.env, meta.slug);
  if (html === null) return null;
  track(c, "OnePager Viewed", { slug: meta.slug, anonymous: true });
  return c.html(html, 200, { ...hardened("'none'"), "cache-control": "public, max-age=60" });
}

// The landing page is LAUNCH_SLUG, served to anyone. Without one, / is the dashboard.
pages.get("/", async (c) => (await publicPage(c, c.env.LAUNCH_SLUG)) ?? c.redirect("/me", 302));

// Signed-out visitors see a public page bare (no comments sidebar); everyone else
// falls through to the normal, signed-in view.
const publicView = createMiddleware<AppEnv>(async (c, next) => {
  if (!(await resolveCaller(c, "session"))) {
    const res = await publicPage(c, c.req.param("slug"));
    if (res) return res;
  }
  await next();
});

// The owner always sees who else can: a pill, or a strip across the top when public.
pages.get("/p/:slug", publicView, browser, async (c) => {
  const slug = c.req.param("slug");
  const meta = await viewable(c, slug);
  if (meta instanceof Response) return meta;
  const badge = isOwner(meta, c.var.caller) ? visibilityBadge(slug, meta.visibility) : "";
  if (meta.comments_enabled) {
    await recordView(c, slug);
    track(c, "OnePager Viewed", { slug, comments_enabled: true });
    return page(c, <Wrapper slug={slug} title={meta.title} badge={badge} />, 200, { "cache-control": "private, max-age=60" });
  }
  const html = await pagers.html(c.env, slug);
  if (html === null) return noPager(c, slug);
  await recordView(c, slug);
  track(c, "OnePager Viewed", { slug, comments_enabled: false });
  return c.html(html + badge, 200, hardened("'none'"));
});

// The iframe inside the comments wrapper. It exists only for pagers with comments
// on; frame-ancestors 'self' is what lets the wrapper frame it at all.
pages.get("/p/:slug/raw", browser, async (c) => {
  const slug = c.req.param("slug");
  const meta = await viewable(c, slug);
  if (meta instanceof Response) return meta;
  if (!meta.comments_enabled) return noPager(c, slug);
  const html = await pagers.html(c.env, slug);
  if (html === null) return noPager(c, slug);
  return c.html(html + SELECTION_SHIM, 200, hardened("'self'"));
});

// A historical version is never wrapped: anchors were recorded against the current DOM.
pages.get("/p/:slug/v/:n", browser, async (c) => {
  const slug = c.req.param("slug");
  const raw = c.req.param("n");
  const n = /^\d+$/.test(raw) ? Number(raw) : 0;
  const meta = await viewable(c, slug);
  if (meta instanceof Response) return meta;
  const html = n > 0 && n <= meta.version_count ? await pagers.html(c.env, slug, n) : null;
  if (html === null) return notFound(c, "OnePager version", raw);
  await recordView(c, slug);
  return c.html(html, 200, hardened("'none'"));
});

// ── comments JSON ─────────────────────────────────────────────────────────────
// "No such pager", "comments off" and "you may not read it" are the same 404, so a
// caller who cannot read a pager learns nothing about its thread.

const commentJson = (x: comments.Comment) => ({ ...x, created_at: iso8601(x.created_at), resolved_at: iso8601(x.resolved_at) });

async function stream(c: Context<AppEnv>, slug: string): Promise<pagers.PagerMeta | Response> {
  const meta = await pagers.get(c.env, slug);
  const caller = c.var.caller;
  if (!meta || !meta.comments_enabled || !(await canView(meta, caller, caller.email, grants.lookup(c.env))))
    return notFound(c, "OnePager", slug);
  return meta;
}

/** Author or pager owner, past the stream gate. */
async function ownComment(c: Context<AppEnv>): Promise<{ meta: pagers.PagerMeta; owner: boolean } | Response> {
  const slug = c.req.param("slug")!;
  const id = c.req.param("id")!;
  const meta = await stream(c, slug);
  if (meta instanceof Response) return meta;
  const found = await comments.get(c.env, slug, id);
  if (!found) return notFound(c, "Comment", id);
  const owner = isOwner(meta, c.var.caller);
  if (!owner && found.author_oid !== c.var.caller.id) return forbidden(c);
  return { meta, owner };
}

pages.get("/p/:slug/comments", session, async (c) => {
  const slug = c.req.param("slug");
  const meta = await stream(c, slug);
  if (meta instanceof Response) return meta;
  const list = await comments.list(c.env, slug);
  return c.json({ comments: list.map(commentJson) }, 200, { "cache-control": "no-store" });
});

pages.post("/p/:slug/comments", session, async (c) => {
  const slug = c.req.param("slug");
  const meta = await stream(c, slug);
  if (meta instanceof Response) return meta;
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const v = validate(body, [
    { field: "text", strip: true, min: 1, max: 4000 },
    { field: "anchor_selector", min: 1, max: 1000 },
    { field: "anchor_text_snippet", min: 1, max: 200 },
    { field: "parent_comment_id", optional: true },
  ]);
  if (!v.ok) return validationFailed(c, v.details);
  const made = await comments.post(c.env, slug, c.var.caller, v.values as any);
  track(c, "Comment Posted", { slug, comment_id: made.comment_id, is_reply: made.parent_comment_id !== null });
  return c.json(commentJson(made), 201);
});

pages.delete("/p/:slug/comments/:id", session, async (c) => {
  const ok = await ownComment(c);
  if (ok instanceof Response) return ok;
  if (!(await comments.remove(c.env, c.req.param("slug"), c.req.param("id")))) return notFound(c, "Comment", c.req.param("id"));
  track(c, "Comment Deleted", { slug: c.req.param("slug"), was_owner_action: ok.owner });
  return noContent(c);
});

pages.post("/p/:slug/comments/:id/resolve", session, async (c) => {
  const ok = await ownComment(c);
  if (ok instanceof Response) return ok;
  await comments.resolve(c.env, c.req.param("slug"), c.req.param("id"));
  track(c, "Comment Resolved", { slug: c.req.param("slug"), was_owner_action: ok.owner });
  return noContent(c);
});

// ── dashboard ─────────────────────────────────────────────────────────────────

pages.get("/me", browser, async (c) => {
  const caller = c.var.caller;
  const q = (c.req.query("q") ?? "").trim();
  const group = (c.req.query("group") ?? "").trim();
  const [rows, owned] = await Promise.all([
    pagers.listFor(c.env, caller, caller.email, q || null),
    groups.listFor(c.env, caller.id),
  ]);
  const slugs = rows.map((r) => r.slug);
  const [memberships, counts] = await Promise.all([groups.groupsOf(c.env, slugs), views.counts(c.env, slugs)]);
  const board = rows
    .map((r) => ({ ...r, groups: memberships.get(r.slug) ?? [], views: counts.get(r.slug) ?? 0 }))
    .filter((r) => !group || r.groups.includes(group));
  return page(c, <Dashboard user={caller} rows={board} groups={owned} q={q} group={group} />);
});

// The dashboard's own JSON twins of the owner-only API routes, cookie-authenticated.
async function ownedPager(c: Context<AppEnv>): Promise<pagers.PagerMeta | Response> {
  const slug = c.req.param("slug")!;
  const meta = await pagers.get(c.env, slug);
  if (!meta) return notFound(c, "OnePager", slug);
  if (!isOwner(meta, c.var.caller)) return forbidden(c);
  return meta;
}

pages.delete("/me/onepagers/:slug", session, async (c) => {
  const meta = await ownedPager(c);
  if (meta instanceof Response) return meta;
  await pagers.remove(c.env, meta.slug);
  track(c, "OnePager Deleted", { slug: meta.slug });
  return noContent(c);
});

pages.get("/me/onepagers/:slug/viewers", session, async (c) => {
  const meta = await ownedPager(c);
  if (meta instanceof Response) return meta;
  const list = await views.viewers(c.env, meta.slug, c.var.caller.id);
  return c.json({
    slug: meta.slug,
    viewers: list.map((v) => ({ email: v.email, views: v.view_count, last_viewed: iso8601(v.last_viewed_at) })),
  }, 200, { "cache-control": "no-store" });
});

// ── gallery and tokens ────────────────────────────────────────────────────────

pages.get("/g/:group", browser, async (c) => {
  const slug = c.req.param("group");
  const group = await groups.get(c.env, slug);
  if (!group) return page(c, <NoGroup slug={slug} />, 404, { "cache-control": "no-store" });
  const caller: Caller = c.var.caller;
  const lookup = grants.lookup(c.env);
  const metas = await Promise.all((await groups.members(c.env, slug)).map((s) => pagers.get(c.env, s)));
  const cards: pagers.PagerMeta[] = [];
  // Members the caller may not read are dropped silently, never counted.
  for (const m of metas) if (m && (await canView(m, caller, caller.email, lookup))) cards.push(m);
  return page(c, <Gallery user={caller} name={group.name} cards={cards} />, 200, { "cache-control": "private, max-age=30" });
});

pages.get("/settings/tokens", browser, async (c) => {
  const list = await tokens.list(c.env, c.var.caller.id);
  return page(c, <Tokens user={c.var.caller} tokens={list} baseUrl={c.env.PUBLIC_BASE_URL} />, 200, { "cache-control": "no-store" });
});
