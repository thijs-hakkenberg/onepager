-- Users are keyed "<provider>:<subject>" (e.g. "github:1234"); that string plays the
-- role the Entra oid played in the Azure stack and is what `*_oid` fields carry.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  email       TEXT,
  name        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX users_email ON users (email);

-- Only the sha256 of the session cookie is stored.
CREATE TABLE sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);

CREATE TABLE onepagers (
  slug              TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  title             TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  content_sha256    TEXT NOT NULL,
  comments_enabled  INTEGER NOT NULL DEFAULT 0,
  eyes_only         INTEGER NOT NULL DEFAULT 0,
  version_count     INTEGER NOT NULL,
  search_text       TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  last_updated_at   TEXT
);
CREATE INDEX onepagers_owner ON onepagers (owner_id);

CREATE TABLE versions (
  slug                  TEXT NOT NULL,
  n                     INTEGER NOT NULL,
  published_by          TEXT NOT NULL,
  published_at          TEXT NOT NULL,
  size_bytes            INTEGER NOT NULL,
  content_sha256        TEXT NOT NULL,
  title                 TEXT NOT NULL,
  original_filename     TEXT NOT NULL,
  comments_enabled      INTEGER NOT NULL,
  eyes_only             INTEGER NOT NULL,
  restored_from_version INTEGER,
  PRIMARY KEY (slug, n)
);

CREATE TABLE grants (
  slug        TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('viewer', 'contributor')),
  granted_by  TEXT NOT NULL,
  granted_at  TEXT NOT NULL,
  PRIMARY KEY (slug, email)
);
CREATE INDEX grants_email ON grants (email);

CREATE TABLE comments (
  slug                TEXT NOT NULL,
  comment_id          TEXT NOT NULL,
  parent_comment_id   TEXT,
  author_id           TEXT NOT NULL,
  author_name         TEXT NOT NULL,
  text                TEXT NOT NULL,
  anchor_selector     TEXT NOT NULL,
  anchor_text_snippet TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  resolved_at         TEXT,
  PRIMARY KEY (slug, comment_id)
);

CREATE TABLE views (
  slug            TEXT NOT NULL,
  viewer_id       TEXT NOT NULL,
  view_count      INTEGER NOT NULL,
  last_viewed_at  TEXT NOT NULL,
  PRIMARY KEY (slug, viewer_id)
);

CREATE TABLE groups (
  slug        TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX groups_owner ON groups (owner_id);

CREATE TABLE group_members (
  group_slug  TEXT NOT NULL,
  pager_slug  TEXT NOT NULL,
  added_at    TEXT NOT NULL,
  PRIMARY KEY (group_slug, pager_slug)
);
CREATE INDEX group_members_pager ON group_members (pager_slug);

CREATE TABLE tokens (
  token_id      TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  secret_hash   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);
CREATE INDEX tokens_owner ON tokens (owner_id);

CREATE TABLE idempotency (
  owner_id        TEXT NOT NULL,
  key             TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (owner_id, key)
);
