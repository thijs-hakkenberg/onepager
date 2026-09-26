// Author HTML is served under `sandbox allow-scripts` with an opaque origin, so
// scripts and handlers stay. What goes is what escapes the sandbox's intent:
// a <base> that re-roots links, a meta refresh that navigates away, and an iframe
// that embeds anything other than this service.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function iframeSrcAllowed(raw: string | null, allowedHosts: readonly string[]): boolean {
  if (raw === null) return false;
  // Browsers drop tabs/newlines and treat "\" as "/" before parsing — do the same,
  // or "java\tscript:" and "\\evil.example" would pass as relative paths.
  const src = raw.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "").replace(/\\/g, "/");
  if (src === "") return false;
  if (!SCHEME.test(src) && !src.startsWith("//")) return true;
  try {
    const url = new URL(src, "https://relative.invalid/");
    return (url.protocol === "https:" || url.protocol === "http:") && allowedHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

export async function sanitise(html: string, allowedHosts: readonly string[]): Promise<string> {
  const rewriter = new HTMLRewriter()
    .on("base", { element: (el) => el.remove() })
    .on("meta", {
      element(el) {
        if ((el.getAttribute("http-equiv") ?? "").trim().toLowerCase() === "refresh") el.remove();
      },
    })
    .on("iframe", {
      element(el) {
        if (!iframeSrcAllowed(el.getAttribute("src"), allowedHosts)) el.remove();
      },
    });
  return rewriter.transform(new Response(html)).text();
}
