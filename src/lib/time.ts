export const now = () => new Date().toISOString();

// Versions, grants, tokens, comments and groups are serialised the way Python's
// isoformat() does ("+00:00"); listing rows keep the "Z" the CLI has always seen.
export const iso8601 = (at: string | null) => (at === null ? null : at.replace(/Z$/, "+00:00"));
export const iso8601Z = (at: string | null) => at;
