// Two independent axes: `eyes_only` gates who may *look*; grants gate who may *write*.
// A contributor on a public pager may republish; making a pager private does not
// revoke an editor. Groups are never consulted — they are the owner's filing system.

export interface PagerRef {
  slug: string;
  owner_id: string;
  eyes_only: boolean;
}
export type Role = "viewer" | "contributor";
export type RoleLookup = (slug: string, email: string) => Promise<Role | null>;

export const isOwner = (meta: PagerRef, caller: { id: string }) => meta.owner_id === caller.id;

export async function canView(meta: PagerRef, caller: { id: string }, email: string | null, lookup: RoleLookup) {
  if (!meta.eyes_only || isOwner(meta, caller)) return true;
  if (!email) return false;
  const role = await lookup(meta.slug, email);
  return role === "viewer" || role === "contributor";
}

export async function canContribute(meta: PagerRef, caller: { id: string }, email: string | null, lookup: RoleLookup) {
  if (isOwner(meta, caller)) return true;
  if (!email) return false;
  return (await lookup(meta.slug, email)) === "contributor";
}
