// Substring search over the lowercased title plus the stored `search_text` excerpt.
interface Searchable {
  title: string;
  search_text: string;
}

export const terms = (q: string | null | undefined): string[] =>
  q ? q.toLowerCase().split(/\s+/).filter(Boolean) : [];

export function matches(meta: Searchable, ts: string[]): boolean {
  const haystack = `${meta.title.toLowerCase()} ${meta.search_text}`;
  return ts.every((t) => haystack.includes(t));
}

export function matchedContent(meta: Searchable, ts: string[]): boolean {
  const title = meta.title.toLowerCase();
  return ts.some((t) => !title.includes(t) && meta.search_text.includes(t));
}
