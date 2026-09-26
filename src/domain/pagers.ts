import { toSearchText } from "../html/to_text";
import { sha256Hex } from "../lib/random";
import { now } from "../lib/time";
import { generateSlug } from "./slug";
import { matchedContent, matches, terms } from "./search";
import { type Actor, blobKey, bool, type Store } from "./store";

export interface PagerMeta {
  slug: string;
  owner_id: string;
  title: string;
  original_filename: string;
  size_bytes: number;
  content_sha256: string;
  comments_enabled: boolean;
  eyes_only: boolean;
  version_count: number;
  search_text: string;
  created_at: string;
  last_updated_at: string | null;
}

export interface VersionRow {
  version_number: number;
  published_by_oid: string;
  published_at: string;
  size_bytes: number;
  content_sha256: string;
  title: string;
  original_filename: string;
  comments_enabled: boolean;
  restored_from_version: number | null;
}

export interface PublishInput {
  html: string;
  filename: string;
  title: string | null;
  comments_enabled: boolean | null;
  eyes_only: boolean | null;
}

export class ConflictError extends Error {}

const toMeta = (r: Record<string, any>): PagerMeta => ({
  ...(r as PagerMeta),
  comments_enabled: bool(r.comments_enabled),
  eyes_only: bool(r.eyes_only),
});

const toVersion = (r: Record<string, any>): VersionRow => ({
  version_number: r.n,
  published_by_oid: r.published_by,
  published_at: r.published_at,
  size_bytes: r.size_bytes,
  content_sha256: r.content_sha256,
  title: r.title,
  original_filename: r.original_filename,
  comments_enabled: bool(r.comments_enabled),
  restored_from_version: r.restored_from_version,
});

export function defaultTitle(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

async function describe(html: string) {
  const bytes = new TextEncoder().encode(html);
  return { bytes, size_bytes: bytes.length, content_sha256: await sha256Hex(bytes), search_text: await toSearchText(html) };
}

export async function get(env: Store, slug: string): Promise<PagerMeta | null> {
  const row = await env.DB.prepare("SELECT * FROM onepagers WHERE slug = ?").bind(slug).first();
  return row ? toMeta(row) : null;
}

export async function html(env: Store, slug: string, n?: number): Promise<string | null> {
  let version = n;
  if (version === undefined) {
    const meta = await get(env, slug);
    if (!meta) return null;
    version = meta.version_count;
  }
  return env.HTML.get(blobKey(slug, version), "text");
}

// Blob first, rows second: a failed D1 write leaves at most an orphaned blob,
// which is deleted on the way out; rows never point at a missing blob.
async function withBlob<T>(env: Store, key: string, bytes: Uint8Array, write: () => Promise<T>): Promise<T> {
  await env.HTML.put(key, bytes);
  try {
    return await write();
  } catch (err) {
    await env.HTML.delete(key).catch(() => {});
    throw err;
  }
}

const insertVersion = (env: Store, slug: string, n: number, by: string, at: string, v: Omit<VersionRow, "version_number" | "published_by_oid" | "published_at">, eyesOnly: boolean) =>
  env.DB.prepare(
    `INSERT INTO versions (slug, n, published_by, published_at, size_bytes, content_sha256, title,
       original_filename, comments_enabled, eyes_only, restored_from_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(slug, n, by, at, v.size_bytes, v.content_sha256, v.title, v.original_filename,
    v.comments_enabled ? 1 : 0, eyesOnly ? 1 : 0, v.restored_from_version);

export async function publish(env: Store, owner: Actor, input: PublishInput) {
  const d = await describe(input.html);
  const title = input.title ?? defaultTitle(input.filename);
  const comments = input.comments_enabled ?? false;
  const eyesOnly = input.eyes_only ?? false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug();
    if (await get(env, slug)) continue;
    const at = now();
    try {
      await withBlob(env, blobKey(slug, 1), d.bytes, () =>
        env.DB.batch([
          env.DB.prepare(
            `INSERT INTO onepagers (slug, owner_id, title, original_filename, size_bytes, content_sha256,
               comments_enabled, eyes_only, version_count, search_text, created_at, last_updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`,
          ).bind(slug, owner.id, title, input.filename, d.size_bytes, d.content_sha256, comments ? 1 : 0, eyesOnly ? 1 : 0, d.search_text, at),
          insertVersion(env, slug, 1, owner.id, at, {
            size_bytes: d.size_bytes, content_sha256: d.content_sha256, title,
            original_filename: input.filename, comments_enabled: comments, restored_from_version: null,
          }, eyesOnly),
        ]),
      );
      return { slug, version_number: 1 };
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  throw new Error("could not allocate a slug");
}

// The version insert carries the concurrency check: two republishes racing for the
// same n collide on the (slug, n) primary key and the batch rolls back as a unit.
async function appendVersion(env: Store, meta: PagerMeta, by: string, bytes: Uint8Array, v: Omit<VersionRow, "version_number" | "published_by_oid" | "published_at">, eyesOnly: boolean, searchText: string) {
  const n = meta.version_count + 1;
  const at = now();
  try {
    await withBlob(env, blobKey(meta.slug, n), bytes, () =>
      env.DB.batch([
        insertVersion(env, meta.slug, n, by, at, v, eyesOnly),
        env.DB.prepare(
          `UPDATE onepagers SET title = ?, original_filename = ?, size_bytes = ?, content_sha256 = ?,
             comments_enabled = ?, eyes_only = ?, version_count = ?, search_text = ?, last_updated_at = ?
           WHERE slug = ?`,
        ).bind(v.title, v.original_filename, v.size_bytes, v.content_sha256, v.comments_enabled ? 1 : 0,
          eyesOnly ? 1 : 0, n, searchText, at, meta.slug),
      ]),
    );
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new ConflictError("concurrent update");
    throw err;
  }
  return { n, at };
}

export async function republish(env: Store, meta: PagerMeta, by: Actor, input: PublishInput) {
  const d = await describe(input.html);
  const { n } = await appendVersion(env, meta, by.id, d.bytes, {
    size_bytes: d.size_bytes, content_sha256: d.content_sha256, title: input.title ?? meta.title,
    original_filename: input.filename, comments_enabled: input.comments_enabled ?? meta.comments_enabled,
    restored_from_version: null,
  }, input.eyes_only ?? meta.eyes_only, d.search_text);
  return { slug: meta.slug, version_number: n };
}

export async function restore(env: Store, meta: PagerMeta, by: Actor, from: number): Promise<VersionRow | null> {
  const row = await env.DB.prepare("SELECT * FROM versions WHERE slug = ? AND n = ?").bind(meta.slug, from).first();
  const content = row && (await env.HTML.get(blobKey(meta.slug, from), "text"));
  if (!row || content === null) return null;
  const source = toVersion(row);
  const v = {
    size_bytes: source.size_bytes, content_sha256: source.content_sha256, title: source.title,
    original_filename: source.original_filename, comments_enabled: source.comments_enabled, restored_from_version: from,
  };
  const { n, at } = await appendVersion(env, meta, by.id, new TextEncoder().encode(content), v, meta.eyes_only, await toSearchText(content));
  return { version_number: n, published_by_oid: by.id, published_at: at, ...v };
}

export async function versions(env: Store, slug: string): Promise<VersionRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE slug = ? ORDER BY n DESC").bind(slug).all();
  return results.map(toVersion);
}

export async function version(env: Store, slug: string, n: number): Promise<VersionRow | null> {
  const row = await env.DB.prepare("SELECT * FROM versions WHERE slug = ? AND n = ?").bind(slug, n).first();
  return row ? toVersion(row) : null;
}

export async function remove(env: Store, slug: string): Promise<boolean> {
  const [gone] = await env.DB.batch([
    env.DB.prepare("DELETE FROM onepagers WHERE slug = ?").bind(slug),
    ...["versions", "grants", "views", "comments"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE slug = ?`).bind(slug)),
    env.DB.prepare("DELETE FROM group_members WHERE pager_slug = ?").bind(slug),
  ]);
  // KV has no bulk delete; one call per stored version.
  let cursor: string | undefined;
  do {
    const page = await env.HTML.list({ prefix: `${slug}/`, cursor });
    await Promise.all(page.keys.map((k) => env.HTML.delete(k.name)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return (gone.meta.changes ?? 0) > 0;
}

export interface ListingRow {
  owner_oid: string;
  slug: string;
  title: string;
  original_filename: string;
  size_bytes: number;
  content_sha256: string;
  created_at: string;
  comments_enabled: boolean;
  eyes_only: boolean;
  version_count: number;
  last_updated_at: string;
  role: "owner" | "viewer" | "contributor";
  matched_content?: boolean;
}

export async function listFor(env: Store, caller: { id: string }, email: string | null, q: string | null): Promise<ListingRow[]> {
  const owned = await env.DB.prepare("SELECT *, 'owner' AS role FROM onepagers WHERE owner_id = ? ORDER BY created_at DESC")
    .bind(caller.id).all();
  const shared = email
    ? await env.DB.prepare(
        `SELECT o.*, g.role AS role FROM grants g JOIN onepagers o ON o.slug = g.slug
         WHERE g.email = ? AND o.owner_id != ? ORDER BY o.created_at DESC`,
      ).bind(email.toLowerCase(), caller.id).all()
    : { results: [] as Record<string, any>[] };
  const ts = terms(q);
  const seen = new Set<string>();
  const rows: ListingRow[] = [];
  for (const r of [...owned.results, ...shared.results]) {
    if (seen.has(r.slug as string)) continue;
    seen.add(r.slug as string);
    const meta = toMeta(r);
    if (ts.length && !matches(meta, ts)) continue;
    rows.push({
      owner_oid: meta.owner_id, slug: meta.slug, title: meta.title, original_filename: meta.original_filename,
      size_bytes: meta.size_bytes, content_sha256: meta.content_sha256, created_at: meta.created_at,
      comments_enabled: meta.comments_enabled, eyes_only: meta.eyes_only, version_count: meta.version_count,
      last_updated_at: meta.last_updated_at ?? meta.created_at, role: r.role as ListingRow["role"],
      ...(ts.length ? { matched_content: matchedContent(meta, ts) } : {}),
    });
  }
  return rows;
}
