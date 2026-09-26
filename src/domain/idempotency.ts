import { now } from "../lib/time";
import type { Store } from "./store";

const TTL_MS = 24 * 60 * 60 * 1000;

export async function lookup(env: Store, ownerId: string, key: string) {
  const row = await env.DB.prepare("SELECT response_status, response_body, created_at FROM idempotency WHERE owner_id = ? AND key = ?")
    .bind(ownerId, key).first<{ response_status: number; response_body: string; created_at: string }>();
  if (!row || Date.now() - Date.parse(row.created_at) > TTL_MS) return null;
  return { status: row.response_status, body: JSON.parse(row.response_body) };
}

export async function save(env: Store, ownerId: string, key: string, status: number, body: unknown) {
  await env.DB.prepare(
    `INSERT INTO idempotency (owner_id, key, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (owner_id, key) DO UPDATE SET response_status = excluded.response_status,
       response_body = excluded.response_body, created_at = excluded.created_at`,
  ).bind(ownerId, key, status, JSON.stringify(body), now()).run();
}
