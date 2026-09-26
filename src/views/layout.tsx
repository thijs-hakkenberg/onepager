import type { Child } from "hono/jsx";

export interface Viewer {
  email: string | null;
  name: string | null;
}

// Every script and style is external: the chrome CSP has no 'unsafe-inline'.
export function Layout(props: { title: string; user?: Viewer | null; scripts?: string[]; children?: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/app.css" />
        {(props.scripts ?? []).map((src) => <script src={src} defer />)}
      </head>
      <body>
        <main class="page">
          {props.user !== undefined && (
            <nav class="topnav">
              <a href="/me">Your OnePagers</a>
              <a href="/settings/tokens">Plugin tokens</a>
              {props.user && (
                <span class="who">
                  {props.user.email ?? props.user.name}
                  <form method="post" action="/logout" class="inline">
                    <button type="submit" class="link">Sign out</button>
                  </form>
                </span>
              )}
            </nav>
          )}
          {props.children}
        </main>
      </body>
    </html>
  );
}

export const Notice = (props: { title: string; heading: string; children?: Child }) => (
  <Layout title={props.title}>
    <div class="notice">
      <h1>{props.heading}</h1>
      {props.children}
    </div>
  </Layout>
);
