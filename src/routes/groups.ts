import { type Context, Hono } from "hono";
import { requireCaller } from "../auth/middleware";
import * as groups from "../domain/groups";
import * as pagers from "../domain/pagers";
import type { AppEnv } from "../env";
import { error, forbidden, jsonBody, noContent, notFound, validationFailed } from "../lib/http";
import { validate } from "../lib/params";
import { iso8601 } from "../lib/time";
import { SLUG_SHAPE } from "./onepagers";

const summary = (g: groups.Group) => ({ group_slug: g.group_slug, name: g.name, created_at: iso8601(g.created_at) });

export const groupsApi = new Hono<AppEnv>();
groupsApi.use("*", requireCaller("bearer"));

groupsApi.post("/", async (c) => {
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const v = validate(body, [
    { field: "group_slug", strip: true, min: 1, shape: SLUG_SHAPE },
    { field: "name", strip: true, min: 1, max: 200 },
  ]);
  if (!v.ok) return validationFailed(c, v.details);
  const made = await groups.create(c.env, c.var.caller.id, v.values.group_slug, v.values.name);
  if (!made) return error(c, 409, `A group already exists at /g/${v.values.group_slug}`);
  return c.json({ group_slug: made.group_slug, name: made.name }, 201);
});

groupsApi.get("/", async (c) => c.json({ groups: (await groups.listFor(c.env, c.var.caller.id)).map(summary) }));

/** Every route below acts on one group, which the caller must own. */
async function owned(c: Context<AppEnv>): Promise<groups.Group | Response> {
  const slug = c.req.param("slug")!;
  const group = await groups.get(c.env, slug);
  if (!group) return notFound(c, "Group", slug);
  if (group.owner_id !== c.var.caller.id) return forbidden(c, "Forbidden — only the owner can manage this group");
  return group;
}

groupsApi.get("/:slug", async (c) => {
  const group = await owned(c);
  if (group instanceof Response) return group;
  return c.json({ ...summary(group), members: await groups.members(c.env, group.group_slug) });
});

groupsApi.post("/:slug/members", async (c) => {
  const group = await owned(c);
  if (group instanceof Response) return group;
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const v = validate(body, [{ field: "pager_slug", strip: true, min: 1, shape: SLUG_SHAPE }]);
  if (!v.ok) return validationFailed(c, v.details);
  const meta = await pagers.get(c.env, v.values.pager_slug);
  if (!meta) return notFound(c, "OnePager", v.values.pager_slug);
  if (meta.owner_id !== c.var.caller.id) return forbidden(c, "Forbidden — you can only add OnePagers you own");
  await groups.addMember(c.env, group.group_slug, meta.slug);
  return c.json({ group_slug: group.group_slug, pager_slug: meta.slug }, 201);
});

groupsApi.delete("/:slug/members/:pager", async (c) => {
  const group = await owned(c);
  if (group instanceof Response) return group;
  const pager = c.req.param("pager");
  if (!(await groups.removeMember(c.env, group.group_slug, pager))) return notFound(c, "OnePager", pager);
  return noContent(c);
});

groupsApi.delete("/:slug", async (c) => {
  const group = await owned(c);
  if (group instanceof Response) return group;
  await groups.remove(c.env, group.group_slug);
  return noContent(c);
});
