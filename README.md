# OnePager on Cloudflare

Publish, version, share and comment on single-file HTML pages. It runs on the Cloudflare
Workers free tier: one Worker, a D1 database for metadata and an R2 bucket for the HTML.

- **Sign-in** with GitHub or Google OAuth, handled inside the Worker.
- **Publishing** goes through a bearer-token REST API at `/api/v1` (compatible with the
  OnePager Claude Code plugin). Tokens are minted at `/settings/tokens`.
- **Viewing**: `/p/<slug>` serves the page under a sandboxing CSP, optionally beside a
  comments sidebar where readers anchor comments to a text selection.
- **Access**: every signed-in user can view a normal page. An *eyes-only* page is visible
  to its owner and to the emails it has been shared with. `contributor` grants may
  republish. Groups (`/g/<group>`) are curated galleries and never grant access.

## Layout

```
src/app.ts             route wiring (Hono)
src/auth/              OAuth sign-in, sessions, bearer tokens, credential middleware
src/domain/            D1/R2 data layer and the access rules
src/html/              sanitiser, text extraction, comment selection shim
src/routes/            JSON API and server-rendered pages
src/views/             Hono JSX views
public/                static CSS and the browser scripts (comments, dashboard, tokens)
migrations/            D1 schema
test/                  vitest in workerd via @cloudflare/vitest-pool-workers
```

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars        # fill in at least one OAuth provider
npm run db:migrate:local
npm run dev                           # http://localhost:8787
npm test && npm run typecheck
```

For local sign-in, register an OAuth app whose callback is
`http://localhost:8787/auth/github/callback` (or `/auth/google/callback`).

## Deploying

CI (`.github/workflows/ci.yml`) typechecks and tests every PR and push. On push to `main`
it applies the D1 migrations and runs `wrangler deploy`.

One-time setup:

1. **Create the resources**, then put the printed `database_id` in `wrangler.jsonc`:
   ```sh
   npx wrangler login
   npx wrangler d1 create onepager
   npx wrangler r2 bucket create onepager-html
   ```
2. **Set `PUBLIC_BASE_URL`** in `wrangler.jsonc` to the deployed origin, e.g.
   `https://onepager.<your-subdomain>.workers.dev`.
3. **Create the OAuth apps.** Enable one provider or both; a provider without credentials
   is hidden from the login page.
   - **GitHub:** Settings → Developer settings → OAuth Apps → *New OAuth App*.
     - Homepage: `PUBLIC_BASE_URL`
     - Callback: `PUBLIC_BASE_URL/auth/github/callback`
   - **Google:** Cloud Console → APIs & Services → Credentials → *OAuth client ID* (Web
     application).
     - Authorised redirect URI: `PUBLIC_BASE_URL/auth/google/callback`
4. **Store the Worker secrets:**
   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put MIXPANEL_TOKEN     # optional analytics
   ```
5. **Add the GitHub Actions secrets** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   (repo → Settings → Secrets and variables → Actions). Create the API token from the
   *Edit Cloudflare Workers* template, and add *Account → D1 → Edit* so migrations can run.

Configuration (`vars` in `wrangler.jsonc`):

| Var | Meaning |
|---|---|
| `PUBLIC_BASE_URL` | Origin used in OAuth callbacks, returned URLs and the Origin check |
| `LAUNCH_SLUG` | If set, `/` redirects to `/p/<LAUNCH_SLUG>`; otherwise it redirects to `/me` |
| `MAX_HTML_BYTES` | Upload cap (default 5 MiB, sized for the free-tier CPU budget) |

## Publishing from the CLI / plugin

Mint a token at `/settings/tokens`, then:

```sh
export ONEPAGER_BASE_URL=https://onepager.<your-subdomain>.workers.dev
export ONEPAGER_TOKEN=op_...

curl -sS "$ONEPAGER_BASE_URL/api/v1/onepagers" \
  -H "Authorization: Bearer $ONEPAGER_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile html page.html '{html:$html, filename:"page.html", title:"My page", comments_enabled:true}')"
```

To republish a page, pass `"slug": "<slug>"`. Every API endpoint is listed in
`src/routes/onepagers.ts`, `groups.ts` and `tokens.ts`.

## Security notes

- Author HTML is sanitised on upload and then served under
  `Content-Security-Policy: sandbox allow-scripts …` without `allow-same-origin`. It
  therefore runs in an opaque origin: it cannot read the session cookie or call the API as
  the viewer.
- Sessions are random 256-bit cookies. D1 stores only their SHA-256.
- Bearer tokens are `op_<id>_<secret>`. Only the secret's SHA-256 is stored, and it is
  compared in constant time.
- A cookie-authenticated write must carry a same-origin `Origin` header.

## Licence

See `LICENSE`.
