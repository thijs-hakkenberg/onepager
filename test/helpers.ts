import { env, SELF } from "cloudflare:test";
import * as tokens from "../src/domain/tokens";
import * as users from "../src/auth/users";

export const BASE = "https://onepager.test";
let n = 0;

export interface Person {
  id: string;
  email: string;
  cookie: string;
  bearer: string;
}

export async function person(name = "Pat"): Promise<Person> {
  const id = `github:${Date.now()}${++n}`;
  const email = `${name.toLowerCase()}${n}@people.test`;
  await users.upsert(env, { id, provider: "github", email, name });
  const cookie = await users.createSession(env, id);
  const { full } = await tokens.create(env, id, "test");
  return { id, email, cookie, bearer: full };
}

type Init = RequestInit & { json?: unknown; as?: Person; via?: "bearer" | "cookie" };

export function call(path: string, init: Init = {}) {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (init.as) {
    if ((init.via ?? "bearer") === "bearer") headers.set("authorization", `Bearer ${init.as.bearer}`);
    else {
      headers.set("cookie", `op_session=${init.as.cookie}`);
      if (!headers.has("origin")) headers.set("origin", BASE);
    }
  }
  return SELF.fetch(BASE + path, {
    ...init,
    headers,
    redirect: "manual",
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

export async function publish(as: Person, body: Record<string, unknown> = {}) {
  const res = await call("/api/v1/onepagers", {
    method: "POST", as, json: { html: "<h1>Hello</h1><p>world</p>", filename: "hello.html", ...body },
  });
  return { res, body: (await res.json()) as any };
}
