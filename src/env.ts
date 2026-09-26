export interface Bindings {
  DB: D1Database;
  HTML: KVNamespace;
  ASSETS: Fetcher;
  PUBLIC_BASE_URL: string;
  LAUNCH_SLUG?: string;
  PUBLIC_SLUGS?: string;
  MAX_HTML_BYTES?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MIXPANEL_TOKEN?: string;
}

export interface Caller {
  id: string;
  email: string | null;
  name: string | null;
  via: "session" | "bearer";
}

export type AppEnv = { Bindings: Bindings; Variables: { caller: Caller } };
