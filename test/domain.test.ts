import { describe, expect, it } from "vitest";
import { generateSlug, isValidSlug } from "../src/domain/slug";
import { hashSecret, mintToken, parseBearer } from "../src/auth/token";
import { canContribute, canView, isOwner } from "../src/domain/access";
import { validate } from "../src/lib/params";
import { matchedContent, matches, terms } from "../src/domain/search";

describe("slug", () => {
  it("generates 8 lowercase base36 chars by default", () => {
    for (let i = 0; i < 200; i++) expect(generateSlug()).toMatch(/^[a-z0-9]{8}$/);
  });
  it("honours a custom size", () => expect(generateSlug(12)).toHaveLength(12));
  it("rejects non-positive sizes", () => expect(() => generateSlug(0)).toThrow());
  it("validates shape", () => {
    expect(isValidSlug("abc123")).toBe(true);
    expect(isValidSlug("ABC")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("a-b")).toBe(false);
    expect(isValidSlug("abc", 3)).toBe(true);
    expect(isValidSlug("abc", 4)).toBe(false);
  });
});

describe("token", () => {
  it("mints op_<12>_<32> base62 and stores only the hash", async () => {
    const { tokenId, full, secretHash } = await mintToken();
    expect(full).toMatch(/^op_[A-Za-z0-9]{12}_[A-Za-z0-9]{32}$/);
    expect(full.split("_")[1]).toBe(tokenId);
    expect(secretHash).toBe(await hashSecret(full.split("_")[2]));
    expect(secretHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("hashes like hashlib.sha256().hexdigest()", async () => {
    expect(await hashSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("parses bearer headers tolerant of whitespace", () => {
    expect(parseBearer("Bearer  op_a_b\n")).toEqual({ tokenId: "a", secret: "b" });
    expect(parseBearer("bearer op_a_b")).toEqual({ tokenId: "a", secret: "b" });
    expect(parseBearer("Bearer op__b")).toBeNull();
    expect(parseBearer("Basic xyz")).toBeNull();
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("Bearer xx_a_b")).toBeNull();
  });
});

describe("access", () => {
  const pub = { slug: "s", owner_id: "u:owner", eyes_only: false };
  const priv = { ...pub, eyes_only: true };
  const owner = { id: "u:owner" };
  const other = { id: "u:other" };

  it("public pagers are visible to any signed-in caller without a grant lookup", async () => {
    const lookup = async () => {
      throw new Error("should not be called");
    };
    expect(await canView(pub, other, "x@y", lookup)).toBe(true);
  });
  it("private pagers: owner yes, grant yes, others no", async () => {
    const none = async () => null;
    expect(await canView(priv, owner, null, none)).toBe(true);
    expect(await canView(priv, other, "x@y", none)).toBe(false);
    expect(await canView(priv, other, null, async () => "viewer")).toBe(false);
    expect(await canView(priv, other, "x@y", async () => "viewer")).toBe(true);
    expect(await canView(priv, other, "x@y", async () => "contributor")).toBe(true);
  });
  it("contribute ignores eyes_only and needs the contributor role", async () => {
    expect(await canContribute(pub, owner, null, async () => null)).toBe(true);
    expect(await canContribute(pub, other, "x@y", async () => "viewer")).toBe(false);
    expect(await canContribute(pub, other, "x@y", async () => "contributor")).toBe(true);
  });
  it("owner is an exact comparison", () => {
    expect(isOwner(pub, owner)).toBe(true);
    expect(isOwner(pub, { id: "U:OWNER" })).toBe(false);
  });
});

describe("params", () => {
  const specs = [
    { field: "html", min: 1 },
    { field: "filename", strip: true, min: 1 },
    { field: "title", optional: true, strip: true },
    { field: "eyes_only", optional: true, type: "boolean" as const },
    { field: "slug", optional: true, strip: true, min: 1, shape: [isValidSlug, "slug must be lowercase alphanumeric"] as const },
  ];
  it("returns typed values", () => {
    expect(validate({ html: "<p>", filename: " a.html ", eyes_only: "yes" }, specs)).toEqual({
      ok: true,
      values: { html: "<p>", filename: "a.html", title: null, eyes_only: true, slug: null },
    });
  });
  it("reports pydantic-shaped details", () => {
    const r = validate({ filename: "  ", eyes_only: "maybe", slug: "Bad!" }, specs);
    expect(r).toEqual({
      ok: false,
      details: [
        { type: "missing", loc: ["html"], msg: "Field required" },
        { type: "string_too_short", loc: ["filename"], msg: "String should have at least 1 character" },
        { type: "bool_parsing", loc: ["eyes_only"], msg: "Input should be a valid boolean, unable to interpret input" },
        { type: "value_error", loc: ["slug"], msg: "Value error, slug must be lowercase alphanumeric" },
      ],
    });
  });
  it("rejects non-strings", () => {
    const r = validate({ html: 5, filename: "a" }, specs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details[0].type).toBe("string_type");
  });
});

describe("search", () => {
  const meta = { title: "Quarterly Plan", search_text: "revenue grew in emea" };
  it("splits and lowercases terms", () => expect(terms("  Foo   BAR ")).toEqual(["foo", "bar"]));
  it("requires every term in title or body", () => {
    expect(matches(meta, ["plan", "emea"])).toBe(true);
    expect(matches(meta, ["plan", "apac"])).toBe(false);
    expect(matches(meta, [])).toBe(true);
  });
  it("flags content-only matches", () => {
    expect(matchedContent(meta, ["plan"])).toBe(false);
    expect(matchedContent(meta, ["revenue"])).toBe(true);
  });
});
