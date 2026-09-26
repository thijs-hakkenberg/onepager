import { decodeEntities } from "./entities";

// Markdown-ish rendering for llm.txt and the search excerpt, ported from
// OnePager.Html.ToText. Not byte-identical to the Python parser, by design.

const HEADINGS: Record<string, string> = { h1: "#", h2: "##", h3: "###", h4: "####", h5: "#####", h6: "######" };
const PARAGRAPH = new Set(["p", "div", "section", "article", "header", "footer", "ul", "ol", "tr"]);
const BLOCK = new Set([...PARAGRAPH, "table", ...Object.keys(HEADINGS)]);
const DROP = new Set(["script", "style", "head", "title", "noscript"]);
// `Element.canHaveContent` is not exposed by workerd, and onEndTag throws on void elements
// and on self-closing foreign ones (`<path/>` in inline SVG). Returns whether it registered.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
function onEnd(el: Element, fn: () => void): boolean {
  if (VOID.has(el.tagName.toLowerCase())) return false;
  try {
    el.onEndTag(fn);
    return true;
  } catch {
    return false;
  }
}
export const SEARCH_TEXT_LIMIT = 30_000;

export async function toMarkdown(html: string): Promise<string> {
  const parts: string[] = [];
  let drop = 0;
  let link: { href: string | null; text: string[] } | null = null;
  // Text arrives in arbitrary chunks (possibly mid-entity), so buffer until the
  // next tag boundary and decode/collapse the whole run at once.
  let pending = "";

  const flush = () => {
    if (!pending) return;
    const text = decodeEntities(pending).replace(/\s+/g, " ");
    pending = "";
    if (drop > 0) return;
    (link ? link.text : parts).push(text);
  };

  const closeLink = () => {
    const text = link!.text.join("").trim();
    parts.push(link!.href && text ? `[${text}](${link!.href})` : text);
    link = null;
  };

  const rewriter = new HTMLRewriter()
    .on("*", {
      element(el) {
        flush();
        const tag = el.tagName.toLowerCase();
        if (DROP.has(tag)) {
          if (onEnd(el, () => { flush(); drop = Math.max(0, drop - 1); })) drop++;
          return;
        }
        // An unclosed <head> would otherwise swallow the whole document.
        if (tag === "body") drop = 0;
        if (drop === 0) {
          if (HEADINGS[tag]) parts.push(`\n\n${HEADINGS[tag]} `);
          else if (tag === "li") parts.push("\n- ");
          else if (PARAGRAPH.has(tag)) parts.push("\n\n");
          else if (tag === "br") parts.push("\n");
          else if (tag === "a") {
            const href = el.getAttribute("href");
            link = { href: href === null ? null : decodeEntities(href), text: [] };
          }
        }
        onEnd(el, () => {
          flush();
          if (drop > 0) return;
          if (tag === "a" && link) closeLink();
          else if (BLOCK.has(tag)) parts.push("\n\n");
        });
      },
    })
    .onDocument({
      text(chunk) {
        pending += chunk.text;
      },
      end() {
        flush();
        if (link) closeLink();
      },
    });

  await rewriter.transform(new Response(html)).text();
  return normalise(parts.join(""));
}

function normalise(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function toSearchText(html: string): Promise<string> {
  const text = (await toMarkdown(html)).replace(/\s+/g, " ").trim().toLowerCase();
  return text.slice(0, SEARCH_TEXT_LIMIT);
}
