import { randomFrom } from "../lib/random";
import { now } from "../lib/time";
import type { Actor, Store } from "./store";

export interface Comment {
  comment_id: string;
  parent_comment_id: string | null;
  author_oid: string;
  author_name: string;
  text: string;
  anchor_selector: string;
  anchor_text_snippet: string;
  created_at: string;
  resolved_at: string | null;
}

const COLUMNS = `comment_id, parent_comment_id, author_id AS author_oid, author_name, text,
  anchor_selector, anchor_text_snippet, created_at, resolved_at`;

export async function list(env: Store, slug: string): Promise<Comment[]> {
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS} FROM comments WHERE slug = ? ORDER BY created_at`).bind(slug).all<Comment>();
  return results;
}

export const get = (env: Store, slug: string, id: string) =>
  env.DB.prepare(`SELECT ${COLUMNS} FROM comments WHERE slug = ? AND comment_id = ?`).bind(slug, id).first<Comment>();

export async function post(
  env: Store,
  slug: string,
  author: Actor,
  input: { text: string; anchor_selector: string; anchor_text_snippet: string; parent_comment_id: string | null },
): Promise<Comment> {
  const c: Comment = {
    comment_id: randomFrom("0123456789abcdefghijklmnopqrstuvwxyz", 12),
    parent_comment_id: input.parent_comment_id,
    author_oid: author.id,
    author_name: author.name || author.id,
    text: input.text,
    anchor_selector: input.anchor_selector,
    anchor_text_snippet: input.anchor_text_snippet,
    created_at: now(),
    resolved_at: null,
  };
  await env.DB.prepare(
    `INSERT INTO comments (slug, comment_id, parent_comment_id, author_id, author_name, text,
       anchor_selector, anchor_text_snippet, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(slug, c.comment_id, c.parent_comment_id, c.author_oid, c.author_name, c.text, c.anchor_selector, c.anchor_text_snippet, c.created_at).run();
  return c;
}

export async function resolve(env: Store, slug: string, id: string) {
  const r = await env.DB.prepare("UPDATE comments SET resolved_at = coalesce(resolved_at, ?) WHERE slug = ? AND comment_id = ?")
    .bind(now(), slug, id).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function remove(env: Store, slug: string, id: string) {
  const r = await env.DB.prepare("DELETE FROM comments WHERE slug = ? AND comment_id = ?").bind(slug, id).run();
  return (r.meta.changes ?? 0) > 0;
}
