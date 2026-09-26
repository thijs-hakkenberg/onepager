import { Hono } from "hono";
import { requireCaller, resolveCaller } from "../auth/middleware";
import { canContribute, canView, isOwner, isPublic, isVisibility, type Role, type Visibility } from "../domain/access";
import * as comments from "../domain/comments";
import * as grants from "../domain/grants";
import * as groups from "../domain/groups";
import * as idem from "../domain/idempotency";
import * as pagers from "../domain/pagers";
import { isValidSlug } from "../domain/slug";
import type { AppEnv } from "../env";
import { commentsMarkdown } from "../html/comments_markdown";
import { sanitise } from "../html/sanitise";
import { toMarkdown } from "../html/to_text";
import { track } from "../lib/analytics";
import { error, forbidden, jsonBody, noContent, notFound, validationFailed } from "../lib/http";
import { type Spec, validate } from "../lib/params";
import { iso8601 } from "../lib/time";

export const SLUG_SHAPE = [(v: string) => isValidSlug(v), "slug must be lowercase alphanumeric"] as const;

export const VISIBILITY_SHAPE = [isVisibility, "visibility must be one of private, signed_in, public"] as const;

/** `visibility` wins; the legacy `eyes_only` flag maps onto private / signed_in. */
const visibilityOf = (p: Record<string, any>): Visibility | null =>
  p.visibility ?? (p.eyes_only === null ? null : p.eyes_only ? "private" : "signed_in");

const PUBLISH: Spec[] = [
  { field: "html", min: 1 },
  { field: "filename", strip: true, min: 1 },
  { field: "title", optional: true, strip: true },
  { field: "comments_enabled", optional: true, type: "boolean" },
  { field: "eyes_only", optional: true, type: "boolean" },
  { field: "visibility", optional: true, strip: true, shape: VISIBILITY_SHAPE },
  { field: "slug", optional: true, strip: true, min: 1, shape: SLUG_SHAPE },
  { field: "group_slug", optional: true, strip: true, min: 1, shape: SLUG_SHAPE },
];

const ROLES: Role[] = ["viewer", "contributor"];
const CONFLICT = "Conflict — another publish landed first; retry";

export const pagerUrl = (base: string, slug: string) => `${base.replace(/\/$/, "")}/p/${slug}`;
export const allowedHosts = (env: { PUBLIC_BASE_URL: string }) => [new URL(env.PUBLIC_BASE_URL).hostname];
const maxHtmlBytes = (env: { MAX_HTML_BYTES?: string }) => Number(env.MAX_HTML_BYTES || 5_242_880);
const versionJson = (v: pagers.VersionRow) => ({ ...v, published_at: iso8601(v.published_at) });

export const api = new Hono<AppEnv>();

api.post("/", requireCaller("bearer"), async (c) => {
  const max = maxHtmlBytes(c.env);
  const tooBig = () => error(c, 413, `HTML exceeds the ${max} byte limit`);
  // JSON escaping can at most ~6x a byte; refuse anything that cannot possibly fit before parsing it.
  if (Number(c.req.header("content-length") ?? 0) > max * 6 + 65_536) return tooBig();
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const v = validate(body, PUBLISH);
  if (!v.ok) return validationFailed(c, v.details);
  const p = v.values;
  if (new TextEncoder().encode(p.html).length > max) return tooBig();

  const caller = c.var.caller;
  const key = p.slug === null ? c.req.header("idempotency-key")?.trim() || null : null;
  if (key) {
    const replay = await idem.lookup(c.env, caller.id, key);
    if (replay) return c.json(replay.body, replay.status as 201);
  }

  if (p.group_slug !== null) {
    const group = await groups.get(c.env, p.group_slug);
    if (!group) return notFound(c, "Group", p.group_slug);
    if (group.owner_id !== caller.id) return forbidden(c, "Forbidden — you can only add OnePagers to a group you own");
  }

  const input = {
    html: await sanitise(p.html, allowedHosts(c.env)),
    filename: p.filename,
    title: p.title || null,
    comments_enabled: p.comments_enabled,
    visibility: visibilityOf(p),
  };

  if (p.slug === null) {
    const { slug, version_number } = await pagers.publish(c.env, caller, input);
    if (p.group_slug !== null) await groups.addMember(c.env, p.group_slug, slug);
    const out = {
      slug, url: pagerUrl(c.env.PUBLIC_BASE_URL, slug), version_number, is_update: false, group_slug: p.group_slug,
      visibility: input.visibility ?? "signed_in",
    };
    if (key) await idem.save(c.env, caller.id, key, 201, out);
    track(c, "OnePager Published", { slug, is_update: false });
    return c.json(out, 201);
  }

  const meta = await pagers.get(c.env, p.slug);
  if (!meta) return notFound(c, "OnePager", p.slug);
  if (!(await canContribute(meta, caller, caller.email, grants.lookup(c.env))))
    return forbidden(c, "Forbidden — you do not own or contribute to this OnePager");
  try {
    const { version_number } = await pagers.republish(c.env, meta, caller, input);
    if (p.group_slug !== null) await groups.addMember(c.env, p.group_slug, meta.slug);
    track(c, "OnePager Published", { slug: meta.slug, is_update: true, version_number });
    return c.json({
      slug: meta.slug, url: pagerUrl(c.env.PUBLIC_BASE_URL, meta.slug), version_number, is_update: true,
      visibility: input.visibility ?? meta.visibility,
    }, 200);
  } catch (err) {
    if (err instanceof pagers.ConflictError) return error(c, 409, CONFLICT);
    throw err;
  }
});

api.get("/", requireCaller("bearer"), async (c) => {
  const caller = c.var.caller;
  return c.json({ onepagers: await pagers.listFor(c.env, caller, caller.email, c.req.query("q") ?? null) });
});

api.delete("/:slug", requireCaller("any"), async (c) => {
  const slug = c.req.param("slug");
  const meta = await pagers.get(c.env, slug);
  if (!meta) return notFound(c, "OnePager", slug);
  if (!isOwner(meta, c.var.caller)) return forbidden(c);
  await pagers.remove(c.env, slug);
  track(c, "OnePager Deleted", { slug });
  return noContent(c);
});

// Who may look, changed in place: no new version. Owner only, like sharing.
api.patch("/:slug", requireCaller("any"), async (c) => {
  const slug = c.req.param("slug");
  const meta = await pagers.get(c.env, slug);
  if (!meta) return notFound(c, "OnePager", slug);
  if (!isOwner(meta, c.var.caller)) return forbidden(c, "Forbidden — only the owner can change visibility");
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const v = validate(body, [{ field: "visibility", strip: true, shape: VISIBILITY_SHAPE }]);
  if (!v.ok) return validationFailed(c, v.details);
  await pagers.setVisibility(c.env, slug, v.values.visibility);
  track(c, "OnePager Visibility Changed", { slug, from: meta.visibility, to: v.values.visibility });
  return c.json({ slug, visibility: v.values.visibility }, 200);
});

// Public pages (see isPublic) are readable without credentials, so an agent can
// fetch instructions with a bare curl. Anyone else gets the usual 401 first.
api.get("/:slug/llm.txt", async (c) => {
  const slug = c.req.param("slug");
  const caller = await resolveCaller(c, "any");
  const meta = await pagers.get(c.env, slug);
  if (!caller) {
    if (!meta || !isPublic(c.env, meta)) {
      c.header("cache-control", "no-store");
      return error(c, 401, "Authentication required");
    }
  } else {
    c.set("caller", caller);
    if (!meta) return notFound(c, "OnePager", slug);
    if (!(await canView(meta, caller, caller.email, grants.lookup(c.env))))
      return forbidden(c, "Forbidden — this OnePager is private");
  }
  let body = (await toMarkdown((await pagers.html(c.env, slug)) ?? "")).replace(/\n+$/, "") + "\n";
  if (meta.comments_enabled) body += `\n${commentsMarkdown(await comments.list(c.env, slug))}`;
  const header = [
    `slug: ${slug}`,
    `url: ${pagerUrl(c.env.PUBLIC_BASE_URL, slug)}`,
    `version: ${meta.version_count}`,
    `updated: ${iso8601(meta.last_updated_at ?? meta.created_at)}`,
    "---",
  ].join("\n");
  return c.text(`${header}\n${body}`, 200, { "cache-control": "private, max-age=60" });
});

api.get("/:slug/versions", requireCaller("bearer"), async (c) => {
  const slug = c.req.param("slug");
  const meta = await pagers.get(c.env, slug);
  if (!meta) return notFound(c, "OnePager", slug);
  const caller = c.var.caller;
  if (!(await canContribute(meta, caller, caller.email, grants.lookup(c.env))))
    return forbidden(c, "Forbidden — version history is for the owner or contributors");
  return c.json({ versions: (await pagers.versions(c.env, slug)).map(versionJson) });
});

api.post("/:slug/versions/:n/restore", requireCaller("bearer"), async (c) => {
  const slug = c.req.param("slug");
  const raw = c.req.param("n");
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(n > 0)) return error(c, 400, "version must be a positive integer");
  const meta = await pagers.get(c.env, slug);
  if (!meta) return notFound(c, "OnePager", slug);
  if (!isOwner(meta, c.var.caller)) return forbidden(c, "Forbidden — only the owner can restore");
  try {
    const restored = await pagers.restore(c.env, meta, c.var.caller, n);
    if (!restored) return notFound(c, "OnePager version", raw);
    track(c, "OnePager Restored", { slug, from_version: n, version_number: restored.version_number });
    return c.json(versionJson(restored), 200);
  } catch (err) {
    if (err instanceof pagers.ConflictError) return error(c, 409, CONFLICT);
    throw err;
  }
});

// Grants: owner only, all three routes.
const SHARE_DENIED = "Forbidden — only the owner can share";

api.post("/:slug/grants", requireCaller("bearer"), async (c) => {
  const slug = c.req.param("slug");
  const meta = await pagers.get(c.env, slug);
  if (!meta) return notFound(c, "OnePager", slug);
  if (!isOwner(meta, c.var.caller)) return forbidden(c, SHARE_DENIED);
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return error(c, 400, "email is required");
  const role = (body.role ?? "viewer") as Role;
  if (!ROLES.includes(role)) return error(c, 400, "role must be one of viewer, contributor");
  await grants.put(c.env, slug, email, role, c.var.caller.id);
  track(c, "OnePager Shared", { slug, role });
  return c.json({ slug, email, role }, 201);
});

api.get("/:slug/grants", requireCaller("bearer"), async (c) => {
  const slug = c.req.param("slug");
  const meta = await pagers.get(c.env, slug);
  if (!meta) return notFound(c, "OnePager", slug);
  if (!isOwner(meta, c.var.caller)) return forbidden(c, SHARE_DENIED);
  const list = await grants.list(c.env, slug);
  return c.json({ grants: list.map((g) => ({ ...g, granted_at: iso8601(g.granted_at) })) });
});

api.delete("/:slug/grants/:email", requireCaller("bearer"), async (c) => {
  const slug = c.req.param("slug");
  const email = decodeURIComponent(c.req.param("email")).trim().toLowerCase();
  const meta = await pagers.get(c.env, slug);
  if (!meta) return notFound(c, "OnePager", slug);
  if (!isOwner(meta, c.var.caller)) return forbidden(c, SHARE_DENIED);
  if (!(await grants.remove(c.env, slug, email))) return notFound(c, "Grant", email);
  return noContent(c);
});
