-- 077 · Lock down (spec 7.1 #5; 28.3a #10) and "make all my sets link-only" (7.1 #10), the two
-- one-tap bulk actions on a person's own sets. Both are functions, because each touches many
-- rows and one of them touches a server-only column (`share_code`): a half-done lock-down is
-- worse than none, and the guard would refuse the app a new code row by row.
--
-- Lock down: every one of the person's sets becomes Only me AND gets a new share code, so every
-- link ever sent stops opening at once (a code in a chat is the thing being locked out); every
-- open poll of theirs closes (its options are now Only me sets). Nothing is deleted, and the
-- person opens sets up again one at a time from Hidden. Previews already sent in chats cannot
-- be pulled back; the app says so before the tap, and takes the chat pictures down afterwards.
--
-- Make all link-only: Public sets become Link-only (anyone with the link, not on the profile);
-- Followers, Friends and Only me sets are already narrower and stay as they are. Codes stay.

create or replace function public.lock_down()
returns integer language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n integer;
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  perform set_config('kleit.server_write', '1', true);
  update public.sets
     set visibility = 'only_me', share_code = private.new_share_code()
   where owner_id = me and deleted_at is null;
  get diagnostics n = row_count;
  update public.polls set closed_at = now()
   where owner_id = me and deleted_at is null and closed_at is null;
  perform set_config('kleit.server_write', '0', true);
  return n;
end $$;
revoke all on function public.lock_down() from public, anon;
grant execute on function public.lock_down() to authenticated;

create or replace function public.make_all_link_only()
returns integer language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n integer;
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  update public.sets set visibility = 'link'
   where owner_id = me and deleted_at is null and visibility = 'public';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.make_all_link_only() from public, anon;
grant execute on function public.make_all_link_only() to authenticated;
