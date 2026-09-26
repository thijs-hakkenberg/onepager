import { hashSecret, mintToken } from "../auth/token";
import { constantTimeEqual } from "../lib/random";
import { now } from "../lib/time";
import type { Store } from "./store";

export async function create(env: Store, ownerId: string, name: string) {
  const { tokenId, full, secretHash } = await mintToken();
  const at = now();
  await env.DB.prepare("INSERT INTO tokens (token_id, owner_id, name, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(tokenId, ownerId, name, secretHash, at).run();
  return { token_id: tokenId, name, full, created_at: at };
}

export async function list(env: Store, ownerId: string) {
  const { results } = await env.DB.prepare(
    "SELECT token_id, name, created_at, last_used_at FROM tokens WHERE owner_id = ? ORDER BY created_at DESC",
  ).bind(ownerId).all<{ token_id: string; name: string; created_at: string; last_used_at: string | null }>();
  return results;
}

export async function remove(env: Store, ownerId: string, tokenId: string) {
  const r = await env.DB.prepare("DELETE FROM tokens WHERE token_id = ? AND owner_id = ?").bind(tokenId, ownerId).run();
  return (r.meta.changes ?? 0) > 0;
}

/** Returns the owning user id, or null for an unknown id or wrong secret. */
export async function verify(env: Store, tokenId: string, secret: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT owner_id, secret_hash FROM tokens WHERE token_id = ?")
    .bind(tokenId).first<{ owner_id: string; secret_hash: string }>();
  // Hash even on a miss so an unknown id costs the same as a wrong secret.
  const presented = await hashSecret(secret);
  if (!row || !constantTimeEqual(presented, row.secret_hash)) return null;
  await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token_id = ?").bind(now(), tokenId).run();
  return row.owner_id;
}
