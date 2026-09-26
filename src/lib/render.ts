import type { Context } from "hono";

// The policy for OnePager's own chrome. Not the one guarding author HTML — the
// viewer routes set theirs per response.
export const CHROME_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export async function page(c: Context, node: unknown, status = 200, headers: Record<string, string> = {}) {
  const html = `<!DOCTYPE html>${await node}`;
  return c.html(html, status as 200, {
    "content-security-policy": CHROME_CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "cache-control": "private, no-cache",
    ...headers,
  });
}
