import { decodeEntities } from "./entities";

// Markdown-ish rendering for llm.txt and the search excerpt, ported from
// OnePager.Html.ToText. Not byte-identical to the Python parser, by design.

const HEADINGS: Record<string, string> = { h1: "#", h2: "##", h3: "###", h4: "####", h5: "#####", h6: "######" };
const PARAGRAPH = new Set(["p", "div", "section", "article", "header", "footer", "ul", "ol", "table"]);
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
const OPEN_FENCE = "\n\n```\n";
const CLOSE_FENCE = "\n```\n\n";

export async function toMarkdown(html: string): Promise<string> {
  const parts: string[] = [];
  let drop = 0;
  // Inside <pre>, whitespace is content: it is kept verbatim and fenced.
  let pre = 0;
  // Tables become pipe tables: a separator row follows the first row.
  let rows = 0;
  let cells = 0;
  let cell = 0;
  let link: { href: string | null; text: string[] } | null = null;
  // Text arrives in arbitrary chunks (possibly mid-entity), so buffer until the
  // next tag boundary and decode/collapse the whole run at once.
  let pending = "";

  const flush = () => {
    if (!pending) return;
    let text = decodeEntities(pending);
    pending = "";
    if (drop > 0) return;
    if (pre === 0) text = text.replace(/\s+/g, " ");
    if (cell > 0) text = text.replace(/\|/g, "\\|");
    // Like a browser, drop the newline that directly follows <pre>.
    else if (parts[parts.length - 1] === OPEN_FENCE) text = text.replace(/^\r?\n/, "");
    emit(text);
  };
  const emit = (text: string) => (link ? link.text : parts).push(text);

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
        if (tag === "table") rows = 0;
        if (drop === 0) {
          if (HEADINGS[tag]) parts.push(`\n\n${HEADINGS[tag]} `);
          else if (tag === "li") parts.push("\n- ");
          else if (PARAGRAPH.has(tag)) parts.push("\n\n");
          else if (tag === "br") emit(cell > 0 ? " " : "\n");
          else if (tag === "tr") {
            cells = 0;
            parts.push("\n|");
          } else if (tag === "td" || tag === "th") {
            cell++;
            parts.push(" ");
          }
          else if (tag === "pre") {
            pre++;
            parts.push(OPEN_FENCE);
          } else if (tag === "code" && pre === 0) emit("`");
          else if (tag === "a") {
            const href = el.getAttribute("href");
            link = { href: href === null ? null : decodeEntities(href), text: [] };
          }
        }
        onEnd(el, () => {
          flush();
          if (drop > 0) return;
          if (tag === "a" && link) closeLink();
          else if (tag === "pre") {
            pre = Math.max(0, pre - 1);
            parts.push(CLOSE_FENCE);
          } else if (tag === "code" && pre === 0) emit("`");
          else if (tag === "td" || tag === "th") {
            cell = Math.max(0, cell - 1);
            cells++;
            parts.push(" |");
          } else if (tag === "tr") {
            if (rows++ === 0) parts.push("\n|" + " --- |".repeat(cells));
          } else if (BLOCK.has(tag)) parts.push("\n\n");
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

// Prose is tidied line by line; fenced blocks are left as written.
function normalise(raw: string): string {
  return raw
    .split(/(\n```\n[\s\S]*?\n```\n)/)
    .map((seg, i) => (i % 2 ? `\`\`\`\n${seg.slice(5, -5).replace(/\s+$/, "")}\n\`\`\`` : prose(seg)))
    .filter(Boolean)
    .join("\n\n");
}

function prose(raw: string): string {
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
