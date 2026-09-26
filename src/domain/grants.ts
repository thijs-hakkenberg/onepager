import { now } from "../lib/time";
import type { Role } from "./access";
import type { Store } from "./store";

export async function put(env: Store, slug: string, email: string, role: Role, by: string) {
  await env.DB.prepare(
    `INSERT INTO grants (slug, email, role, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (slug, email) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at`,
  ).bind(slug, email.toLowerCase(), role, by, now()).run();
}

export async function roleFor(env: Store, slug: string, email: string): Promise<Role | null> {
  const row = await env.DB.prepare("SELECT role FROM grants WHERE slug = ? AND email = ?").bind(slug, email.toLowerCase()).first<{ role: Role }>();
  return row?.role ?? null;
}

export async function list(env: Store, slug: string) {
  const { results } = await env.DB.prepare("SELECT email, role, granted_at FROM grants WHERE slug = ? ORDER BY granted_at")
    .bind(slug).all<{ email: string; role: Role; granted_at: string }>();
  return results;
}

export async function remove(env: Store, slug: string, email: string) {
  const r = await env.DB.prepare("DELETE FROM grants WHERE slug = ? AND email = ?").bind(slug, email.toLowerCase()).run();
  return (r.meta.changes ?? 0) > 0;
}

export const lookup = (env: Store) => (slug: string, email: string) => roleFor(env, slug, email);
