import type { Store } from "../domain/store";
import { randomFrom, sha256Hex } from "../lib/random";
import { now } from "../lib/time";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface User {
  id: string;
  email: string | null;
  name: string | null;
}

export async function upsert(env: Store, u: { id: string; provider: string; email: string | null; name: string | null }) {
  const at = now();
  await env.DB.prepare(
    `INSERT INTO users (id, provider, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, updated_at = excluded.updated_at`,
  ).bind(u.id, u.provider, u.email?.toLowerCase() ?? null, u.name, at, at).run();
}

export const get = (env: Store, id: string) => env.DB.prepare("SELECT id, email, name FROM users WHERE id = ?").bind(id).first<User>();

/** Returns the cookie value; only its sha256 is stored. */
export async function createSession(env: Store, userId: string): Promise<string> {
  const cookie = randomFrom(BASE62, 43);
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(cookie), userId, new Date(Date.now() + SESSION_TTL_MS).toISOString()).run();
  return cookie;
}

export async function sessionUser(env: Store, cookie: string): Promise<User | null> {
  return env.DB.prepare(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256Hex(cookie), now()).first<User>();
}

export async function endSession(env: Store, cookie: string) {
  await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256Hex(cookie)).run();
}

export const SESSION_MAX_AGE_S = SESSION_TTL_MS / 1000;
