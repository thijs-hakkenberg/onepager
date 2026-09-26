import { now } from "../lib/time";
import type { Store } from "./store";

export interface Group {
  group_slug: string;
  owner_id: string;
  name: string;
  created_at: string;
}

const COLUMNS = "slug AS group_slug, owner_id, name, created_at";

export async function create(env: Store, ownerId: string, slug: string, name: string): Promise<Group | null> {
  const at = now();
  const r = await env.DB.prepare("INSERT INTO groups (slug, owner_id, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(slug, ownerId, name, at).run();
  return (r.meta.changes ?? 0) > 0 ? { group_slug: slug, owner_id: ownerId, name, created_at: at } : null;
}

export const get = (env: Store, slug: string) =>
  env.DB.prepare(`SELECT ${COLUMNS} FROM groups WHERE slug = ?`).bind(slug).first<Group>();

export async function listFor(env: Store, ownerId: string) {
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM groups WHERE owner_id = ? ORDER BY created_at`).bind(ownerId).all<Group>();
  return results;
}

export async function members(env: Store, slug: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT pager_slug FROM group_members WHERE group_slug = ? ORDER BY added_at, pager_slug")
    .bind(slug).all<{ pager_slug: string }>();
  return results.map((r) => r.pager_slug);
}

export async function addMember(env: Store, slug: string, pagerSlug: string) {
  await env.DB.prepare("INSERT INTO group_members (group_slug, pager_slug, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(slug, pagerSlug, now()).run();
}

export async function removeMember(env: Store, slug: string, pagerSlug: string) {
  const r = await env.DB.prepare("DELETE FROM group_members WHERE group_slug = ? AND pager_slug = ?").bind(slug, pagerSlug).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function remove(env: Store, slug: string) {
  const [gone] = await env.DB.batch([
    env.DB.prepare("DELETE FROM groups WHERE slug = ?").bind(slug),
    env.DB.prepare("DELETE FROM group_members WHERE group_slug = ?").bind(slug),
  ]);
  return (gone.meta.changes ?? 0) > 0;
}

export async function groupsOf(env: Store, pagerSlugs: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!pagerSlugs.length) return out;
  const { results } = await env.DB.prepare(
    `SELECT pager_slug, group_slug FROM group_members WHERE pager_slug IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(pagerSlugs)).all<{ pager_slug: string; group_slug: string }>();
  for (const r of results) out.set(r.pager_slug, [...(out.get(r.pager_slug) ?? []), r.group_slug]);
  return out;
}
