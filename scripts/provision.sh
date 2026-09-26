#!/usr/bin/env bash
# CI-only: make sure the D1 database and KV namespace exist on the target account and
# point wrangler.jsonc at them, so a fresh account needs nothing but the two
# CLOUDFLARE_* secrets. Idempotent; writes PUBLIC_BASE_URL to $GITHUB_ENV if set.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"

DB=onepager
KV=onepager-html
wrangler() { npx --no-install wrangler "$@"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log($1)})"; }

db_id() { wrangler d1 list --json | json "(j.find(d=>d.name==='$DB')||{}).uuid||''"; }
id=$(db_id)
if [ -z "$id" ]; then
  echo "Creating D1 database $DB"
  wrangler d1 create "$DB" >/dev/null
  id=$(db_id)
fi
[ -n "$id" ] || { echo "could not resolve D1 id for $DB" >&2; exit 1; }

kv_id() { wrangler kv namespace list | json "(j.find(n=>n.title==='$KV')||{}).id||''"; }
kv=$(kv_id)
if [ -z "$kv" ]; then
  echo "Creating KV namespace $KV"
  wrangler kv namespace create "$KV" >/dev/null
  kv=$(kv_id)
fi
[ -n "$kv" ] || { echo "could not resolve KV id for $KV" >&2; exit 1; }

if [ -z "${PUBLIC_BASE_URL:-}" ]; then
  sub=$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" | json "j.result.subdomain")
  PUBLIC_BASE_URL="https://onepager.$sub.workers.dev"
fi

# shellcheck disable=SC2016  # JS template literal, expanded by node
ID="$id" KV_ID="$kv" URL="$PUBLIC_BASE_URL" node -e '
  const fs = require("fs");
  const s = fs.readFileSync("wrangler.jsonc", "utf8")
    .replace(/("database_id":\s*")[^"]*"/, `$1${process.env.ID}"`)
    .replace(/("binding":\s*"HTML",\s*"id":\s*")[^"]*"/, `$1${process.env.KV_ID}"`)
    .replace(/("PUBLIC_BASE_URL":\s*")[^"]*"/, `$1${process.env.URL}"`);
  fs.writeFileSync("wrangler.jsonc", s);'
grep -E '"(database_id|PUBLIC_BASE_URL)"|"HTML"' wrangler.jsonc
[ -n "${GITHUB_ENV:-}" ] && echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL" >> "$GITHUB_ENV"
exit 0
