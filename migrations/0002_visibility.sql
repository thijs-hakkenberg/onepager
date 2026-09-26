-- One visibility level replaces the eyes_only flag:
--   private   — the owner and people with a grant (was eyes_only = 1)
--   signed_in — anyone signed in to this instance (was eyes_only = 0, the default)
--   public    — anyone with the link, no sign-in
-- eyes_only stays, written in step with visibility, so code still running against
-- this schema mid-deploy keeps working. Nothing reads it any more.
ALTER TABLE onepagers ADD COLUMN visibility TEXT NOT NULL DEFAULT 'signed_in'
  CHECK (visibility IN ('private', 'signed_in', 'public'));
UPDATE onepagers SET visibility = 'private' WHERE eyes_only = 1;

ALTER TABLE versions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'signed_in'
  CHECK (visibility IN ('private', 'signed_in', 'public'));
UPDATE versions SET visibility = 'private' WHERE eyes_only = 1;
