---
name: onepager
description: Publish, update, read and share single-file HTML pages on OnePager, which gives each page a versioned, access-controlled link with comments. Use when the user asks to publish, share or host an HTML page, report, dashboard or prototype, to "make a onepager", to update a page they published before, to read a OnePager link or its comments, or to share a page with specific people.
---

# OnePager

OnePager hosts single self-contained HTML files at `<BASE>/p/<slug>`. Every republish
keeps the old version, readers can comment on selected text, and a page can be kept
private to named people. `<BASE>` is `$ONEPAGER_BASE_URL`, or
`https://onepager.prive-thijs-hakkenberg.workers.dev` when that is unset.

The full, always-current reference is public markdown at
`https://onepager.prive-thijs-hakkenberg.workers.dev/api/v1/onepagers/dfad9g7m/llm.txt`.
Fetch it if something here does not cover the task.

## Token

Commands read the token from `$ONEPAGER_TOKEN`, else from `~/.config/onepager/token`.
If neither exists, stop and ask the user to:

1. sign in at `<BASE>/login` and mint a token at `<BASE>/settings/tokens`;
2. save it from their own terminal, not through this session:
   `mkdir -p ~/.config/onepager && printf '%s' 'op_...' > ~/.config/onepager/token && chmod 600 ~/.config/onepager/token`

Anything typed into this session, `!` commands included, lands in the transcript, so
never ask for the token in chat. Never echo it, put it in a page, or commit it.

## Write the page

- One `.html` file, at most 5 MiB, with CSS and JavaScript inline. CDN scripts, Google
  Fonts and absolute `https://` image URLs are fine.
- Give it a `<title>`, and pass `--title` when publishing: that is its name in dashboards.
- It runs in a sandbox with an opaque origin. Scripts work, but `localStorage`,
  `sessionStorage`, IndexedDB and cookies do not and may throw, so wrap any use in
  `try/catch`.
- `<base>`, `<meta http-equiv="refresh">` and iframes to other hosts are stripped.
- Use absolute URLs for links, with `target="_blank" rel="noopener"` for new tabs.
- If comments are on, readers anchor them to selected text, so write real text rather
  than images of text.

## Publish or update

Use `scripts/publish.sh` in this skill's directory:

```sh
scripts/publish.sh report.html --title "Q3 report" --comments   # new page
scripts/publish.sh report.html --slug k3x9ab12                   # new version of it
```

Options: `--slug S` (update that page), `--title T`, `--comments` / `--no-comments`
(sidebar, default off), `--eyes-only` / `--not-eyes-only` (default: any signed-in user
with the link can view), `--group G` (also add the page to your group `G`). On an
update, options you leave out keep their previous values.

It prints `{"slug": ..., "url": ..., "version_number": ..., "is_update": ...}`. Give the
user the `url`. Remember the `slug` for this file (tell the user too) so later edits
update the same page instead of creating a new one. Before creating a page for a file
you may have published earlier, list the user's pages (below) and look for its title.

## Read a page and its feedback

```sh
curl -sS "$BASE/api/v1/onepagers/<slug>/llm.txt" -H "Authorization: Bearer $TOKEN"
```

This returns the page as markdown, followed by the comment threads when comments are
on. When the user says "address the comments", read this first, edit the HTML, then
republish with `--slug`.

## Other operations

Set `BASE` and `TOKEN` first, as `scripts/publish.sh` does:

```sh
BASE="${ONEPAGER_BASE_URL:-https://onepager.prive-thijs-hakkenberg.workers.dev}"
TOKEN="${ONEPAGER_TOKEN:-$(cat ~/.config/onepager/token)}"
```

| Task | Request |
| --- | --- |
| List or search your pages | `GET /api/v1/onepagers?q=<text>` |
| Share (`viewer` or `contributor`) | `POST /api/v1/onepagers/<slug>/grants` with `{"email": "...", "role": "viewer"}` |
| List or remove shares | `GET /api/v1/onepagers/<slug>/grants`, `DELETE /api/v1/onepagers/<slug>/grants/<email>` |
| Version history | `GET /api/v1/onepagers/<slug>/versions` |
| Restore a version (owner) | `POST /api/v1/onepagers/<slug>/versions/<n>/restore` |
| Groups | `POST /api/v1/groups` with `{"group_slug": "q3", "name": "Q3"}`; `POST /api/v1/groups/<g>/members` with `{"pager_slug": "<slug>"}` |
| Delete a page (owner) | `DELETE /api/v1/onepagers/<slug>` |

Every request takes `-H "Authorization: Bearer $TOKEN"`, and a JSON body also takes
`-H "Content-Type: application/json"`. Deleting removes every version for good, so
confirm with the user first. Sharing sends no email; tell the user to pass the link on.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Bad or missing field; `details` says which. Slugs are lowercase letters and digits. |
| 401 | Token missing, revoked or mistyped: ask the user for a new one. |
| 403 | Not the owner or a contributor, or an eyes-only page not shared with you. |
| 404 | No such page, version, group or share. |
| 409 | Someone else published at the same moment: retry once. |
| 413 | Page too large: shrink or externally host the images. |
