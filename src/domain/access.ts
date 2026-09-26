// Two independent axes: `visibility` gates who may *look*; grants gate who may *write*.
// A contributor on a signed-in or public pager may republish; making a pager private
// does not revoke an editor. Groups are never consulted — they are the owner's filing system.

/** Who may look, narrowest first. Grants widen `private` to named people. */
export const VISIBILITIES = ["private", "signed_in", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const isVisibility = (v: unknown): v is Visibility => VISIBILITIES.includes(v as Visibility);

export const VISIBILITY_LABEL: Record<Visibility, { name: string; who: string }> = {
  private: { name: "Eyes only", who: "only you and the people you share it with" },
  signed_in: { name: "Signed in", who: "anyone signed in to OnePager" },
  public: { name: "Public", who: "anyone with the link, no sign-in needed" },
};

export interface PagerRef {
  slug: string;
  owner_id: string;
  visibility: Visibility;
}
export type Role = "viewer" | "contributor";
export type RoleLookup = (slug: string, email: string) => Promise<Role | null>;

/**
 * Readable without signing in: public pagers, plus the launch page and the
 * PUBLIC_SLUGS pages, unless those are private.
 */
export function isPublic(env: { LAUNCH_SLUG?: string; PUBLIC_SLUGS?: string }, meta: PagerRef): boolean {
  if (meta.visibility === "public") return true;
  if (meta.visibility === "private") return false;
  const slugs = [env.LAUNCH_SLUG ?? "", ...(env.PUBLIC_SLUGS ?? "").split(",")].map((s) => s.trim());
  return slugs.includes(meta.slug);
}

export const isOwner = (meta: PagerRef, caller: { id: string }) => meta.owner_id === caller.id;

export async function canView(meta: PagerRef, caller: { id: string }, email: string | null, lookup: RoleLookup) {
  if (meta.visibility !== "private" || isOwner(meta, caller)) return true;
  if (!email) return false;
  const role = await lookup(meta.slug, email);
  return role === "viewer" || role === "contributor";
}

export async function canContribute(meta: PagerRef, caller: { id: string }, email: string | null, lookup: RoleLookup) {
  if (isOwner(meta, caller)) return true;
  if (!email) return false;
  return (await lookup(meta.slug, email)) === "contributor";
}
