#!/usr/bin/env bash
# Publish a single-file HTML page to OnePager, or a new version of an existing one.
#
#   publish.sh FILE [--slug S] [--title T] [--comments|--no-comments]
#                   [--eyes-only|--not-eyes-only] [--group G]
#
# Prints the API's JSON answer ({"slug", "url", "version_number", "is_update", ...}).
# Exits non-zero, with the error body on stdout, on any HTTP error.
set -euo pipefail

BASE="${ONEPAGER_BASE_URL:-https://onepager.prive-thijs-hakkenberg.workers.dev}"
BASE="${BASE%/}"
TOKEN="${ONEPAGER_TOKEN:-$(cat ~/.config/onepager/token 2>/dev/null || true)}"

usage() { sed -n '4,5p' "$0" | sed 's/^# *//' >&2; exit 2; }
[ $# -ge 1 ] || usage
file=$1
shift
[ -f "$file" ] || { echo "No such file: $file" >&2; exit 2; }
if [ -z "$TOKEN" ]; then
  echo "No OnePager token. Mint one at $BASE/settings/tokens, then either export ONEPAGER_TOKEN" >&2
  echo "or save it to ~/.config/onepager/token (chmod 600)." >&2
  exit 3
fi
command -v jq >/dev/null || { echo "publish.sh needs jq" >&2; exit 2; }

args=(--rawfile html "$file" --arg filename "$(basename "$file")")
filter='{html: $html, filename: $filename}'
while [ $# -gt 0 ]; do
  case $1 in
    --slug) args+=(--arg slug "${2:?--slug needs a value}"); filter+=' + {slug: $slug}'; shift 2 ;;
    --title) args+=(--arg title "${2:?--title needs a value}"); filter+=' + {title: $title}'; shift 2 ;;
    --group) args+=(--arg group "${2:?--group needs a value}"); filter+=' + {group_slug: $group}'; shift 2 ;;
    --comments) filter+=' + {comments_enabled: true}'; shift ;;
    --no-comments) filter+=' + {comments_enabled: false}'; shift ;;
    --eyes-only) filter+=' + {eyes_only: true}'; shift ;;
    --not-eyes-only) filter+=' + {eyes_only: false}'; shift ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

# The token reaches curl through a file descriptor, not argv, so `ps` never shows it.
jq -n "${args[@]}" "$filter" |
  curl -sS --fail-with-body "$BASE/api/v1/onepagers" \
    -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") \
    -H "Content-Type: application/json" \
    -d @-
echo
