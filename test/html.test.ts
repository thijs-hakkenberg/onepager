import { describe, expect, it } from "vitest";
import { sanitise } from "../src/html/sanitise";
import { toMarkdown, toSearchText } from "../src/html/to_text";
import { commentsMarkdown } from "../src/html/comments_markdown";

const ALLOWED = ["onepager.test"];

describe("sanitise", () => {
  it("strips <base> so relative links cannot be re-rooted", async () => {
    const out = await sanitise('<head><base href="https://evil.example/"></head><p>x</p>', ALLOWED);
    expect(out).not.toContain("<base");
    expect(out).toContain("<p>x</p>");
  });

  it("strips meta refresh in any case but keeps other meta", async () => {
    const out = await sanitise(
      '<meta http-equiv="Refresh" content="0;url=https://evil.example"><meta charset="utf-8">',
      ALLOWED,
    );
    expect(out).not.toMatch(/refresh/i);
    expect(out).toContain('<meta charset="utf-8">');
  });

  it("drops iframes pointing at foreign hosts with their whole subtree", async () => {
    const out = await sanitise('<iframe src="https://evil.example/x"><p>fallback</p></iframe><p>keep</p>', ALLOWED);
    expect(out).toBe("<p>keep</p>");
  });

  it("drops iframes with no src, an empty src, protocol-relative foreign or script URLs", async () => {
    for (const tag of [
      "<iframe></iframe>",
      '<iframe src=""></iframe>',
      '<iframe src="//evil.example/x"></iframe>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe src="data:text/html,hi"></iframe>',
    ]) {
      expect(await sanitise(tag + "<p>k</p>", ALLOWED)).toBe("<p>k</p>");
    }
  });

  it("keeps iframes on the allowed host and relative ones", async () => {
    const own = '<iframe src="https://onepager.test/p/abc/raw"></iframe>';
    const rel = '<iframe src="/p/abc/raw"></iframe>';
    expect(await sanitise(own, ALLOWED)).toBe(own);
    expect(await sanitise(rel, ALLOWED)).toBe(rel);
  });

  it("keeps author scripts — the sandbox CSP is the isolation boundary", async () => {
    const html = "<script>document.title='x'</script><button onclick=\"go()\">b</button>";
    expect(await sanitise(html, ALLOWED)).toBe(html);
  });
});

describe("toMarkdown", () => {
  it("renders headings, paragraphs, lists, breaks and links", async () => {
    const html =
      "<h1>Title</h1><p>Hello   <b>world</b></p><ul><li>one</li><li>two</li></ul>" +
      '<p>line<br>next <a href="https://x.test">link  text</a> <a>bare</a></p>';
    expect(await toMarkdown(html)).toBe(
      "# Title\n\nHello world\n\n- one\n- two\n\nline\nnext [link text](https://x.test) bare",
    );
  });

  it("drops script, style, head, title and noscript content", async () => {
    const html =
      "<html><head><title>T</title><style>p{}</style></head><body>" +
      "<script>var a = 1</script><noscript>nojs</noscript><p>visible</p></body></html>";
    expect(await toMarkdown(html)).toBe("visible");
  });

  it("does not swallow the body when <head> is never closed", async () => {
    expect(await toMarkdown("<head><meta charset=utf-8><body><p>shown</p>")).toBe("shown");
  });

  it("decodes character references", async () => {
    expect(await toMarkdown("<p>a &amp; b &lt;c&gt; &#233;&#x41;&nbsp;z</p>")).toBe("a & b <c> éA z");
  });

  it("fences <pre> verbatim and backticks inline code", async () => {
    const html = "<p>Run <code>npm  test</code> first.</p><pre>\n$ curl \\\n    -d '{}'\n\n# done\n</pre><p>after</p>";
    expect(await toMarkdown(html)).toBe("Run `npm test` first.\n\n```\n$ curl \\\n    -d '{}'\n\n# done\n```\n\nafter");
    expect(await toMarkdown("<pre><code>a\n  b</code></pre>")).toBe("```\na\n  b\n```");
  });

  it("renders tables as pipe tables", async () => {
    const html = "<p>x</p><table><tr><th>Field</th><th>Meaning</th></tr><tr><td><code>a|b</code></td><td>one<br>two</td></tr></table><p>y</p>";
    expect(await toMarkdown(html)).toBe("x\n\n| Field | Meaning |\n| --- | --- |\n| `a\\|b` | one two |\n\ny");
    const two = "<table><tr><th>A</th></tr></table><table><tr><th>B</th></tr><tr><td>c</td></tr></table>";
    expect(await toMarkdown(two)).toBe("| A |\n| --- |\n\n| B |\n| --- |\n| c |");
  });

  it("tolerates self-closing SVG children", async () => {
    const svg = '<svg viewBox="0 0 8 8"><path d="M0 0"/><rect x="1" y="1"/><title>icon</title></svg>';
    expect(await toMarkdown(`<p>${svg} before</p><p>after</p>`)).toBe("before\n\nafter");
  });

  it("collapses runs of blank lines to one", async () => {
    expect(await toMarkdown("<div><div><p>a</p></div></div><section><p>b</p></section>")).toBe("a\n\nb");
  });
});

describe("toSearchText", () => {
  it("is lowercased with whitespace collapsed", async () => {
    expect(await toSearchText("<h1>Big News</h1><p>Some  TEXT</p>")).toBe("# big news some text");
  });

  it("is capped at 30,000 characters", async () => {
    const text = await toSearchText(`<p>${"word ".repeat(20_000)}</p>`);
    expect(text.length).toBe(30_000);
  });
});

describe("commentsMarkdown", () => {
  const base = { anchor_selector: "body > p", resolved_at: null };
  it("says so when there are none", () => {
    expect(commentsMarkdown([])).toBe("## Comments\n\n_No comments yet._\n");
  });

  it("renders threads oldest first with indented replies", () => {
    const comments = [
      { ...base, comment_id: "r2", parent_comment_id: null, author_name: "Bo", text: "second",
        anchor_text_snippet: "B", created_at: "2026-02-02T10:00:00Z" },
      { ...base, comment_id: "r1", parent_comment_id: null, author_name: "Al", text: "first",
        anchor_text_snippet: "A", created_at: "2026-01-01T10:00:00Z", resolved_at: "2026-01-03T00:00:00Z" },
      { ...base, comment_id: "c1", parent_comment_id: "r1", author_name: "Cy", text: "reply",
        anchor_text_snippet: "A", created_at: "2026-01-02T10:00:00Z" },
    ];
    expect(commentsMarkdown(comments)).toBe(
      '## Comments\n\n### On: "A"\n\n- **Al** (2026-01-01) (resolved): first\n  - **Cy** (2026-01-02): reply\n\n' +
        '### On: "B"\n\n- **Bo** (2026-02-02): second\n',
    );
  });
});
