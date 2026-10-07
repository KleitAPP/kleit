-- 067 · With the delete policy gone (066) a member's DELETE on conversations touched no row and
-- said nothing; the table privilege goes too, so it is refused out loud (42501), the way every
-- other closed door answers.
revoke delete, truncate on table public.conversations from authenticated;
