import { now } from "../lib/time";
import type { Store } from "./store";

export async function record(env: Store, slug: string, viewerId: string) {
  await env.DB.prepare(
    `INSERT INTO views (slug, viewer_id, view_count, last_viewed_at) VALUES (?, ?, 1, ?)
     ON CONFLICT (slug, viewer_id) DO UPDATE SET view_count = view_count + 1, last_viewed_at = excluded.last_viewed_at`,
  ).bind(slug, viewerId, now()).run();
}

export async function viewers(env: Store, slug: string, excludeId: string) {
  const { results } = await env.DB.prepare(
    `SELECT u.email, v.view_count, v.last_viewed_at FROM views v LEFT JOIN users u ON u.id = v.viewer_id
     WHERE v.slug = ? AND v.viewer_id != ? ORDER BY v.last_viewed_at DESC`,
  ).bind(slug, excludeId).all<{ email: string | null; view_count: number; last_viewed_at: string }>();
  return results;
}

export async function counts(env: Store, slugs: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!slugs.length) return out;
  const { results } = await env.DB.prepare(
    `SELECT slug, sum(view_count) AS n FROM views WHERE slug IN (SELECT value FROM json_each(?)) GROUP BY slug`,
  ).bind(JSON.stringify(slugs)).all<{ slug: string; n: number }>();
  for (const r of results) out.set(r.slug, r.n);
  return out;
}
