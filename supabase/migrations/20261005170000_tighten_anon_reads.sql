-- Migration 024 — two doors closed after the M2–M3 adversarial pass (2026-10-05; WA11).
--
-- 1. `set_by_share_code` handed a stranger the whole `sets` row - owner_id, takedown state,
--    comments and remix modes - where the page they came for (`shared_set`) shows a username and
--    a display name. The function stays, because `shared_set` and `shared_poll` are built on it
--    and run as the database owner; it is simply no longer callable from the API.
-- 2. `reserved_usernames` was readable with the public key. The app never reads the table; the
--    `username_status` function (security definer) answers "taken / free / not one we give out"
--    without handing over the list.
revoke execute on function public.set_by_share_code(text) from public, anon, authenticated;
drop policy if exists "reserved_usernames: anyone reads" on public.reserved_usernames;
revoke select on table public.reserved_usernames from anon, authenticated;
