
// The author's document in a sandboxed iframe, with the comments sidebar beside
// it. public/comments.js owns the sidebar and the postMessage bridge.
export const Wrapper = ({ slug, title }: { slug: string; title: string }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · OnePager</title>
      <link rel="stylesheet" href="/app.css" />
      <script src="/comments.js" defer />
    </head>
    <body class="wrapper">
      <iframe id="onepager-frame" src={`/p/${slug}/raw`} title="OnePager content" sandbox="allow-scripts allow-popups" />
      <aside id="sidebar" data-slug={slug}>
        <header>
          <h2>Comments</h2>
          <div class="muted">Click any element in the page to anchor a new thread.</div>
          <div id="notice" class="error" role="status" />
        </header>
        <div id="threads">
          <div class="muted pad">Loading comments…</div>
        </div>
        <form id="composer" autocomplete="off">
          <div id="anchor-line" class="muted small">Anchor: page (general)</div>
          <textarea name="text" rows={3} required placeholder="Add a comment…" maxlength={4000} />
          <div class="row">
            <button type="submit" class="btn primary">Post</button>
            <button type="button" id="cancel-anchor" class="link" hidden>
              Clear anchor
            </button>
          </div>
        </form>
      </aside>
    </body>
  </html>
);
