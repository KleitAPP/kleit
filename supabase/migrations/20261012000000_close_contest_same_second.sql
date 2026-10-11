-- 086 · close_contest_now (085) sets closes_at = now(); a contest opened in the same second (or
-- the same transaction, as test 064 did) then breaks `closes_at > opens_at`. A close is never
-- earlier than a second after the open. Replaced from its latest definition (085, the only one).
create or replace function public.close_contest_now(p_contest uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.contests set closes_at = greatest(now(), opens_at + interval '1 second')
   where id = p_contest and now() >= opens_at and now() < closes_at;
  if not found then return false; end if;
  perform private.announce_closed_contests();
  perform private.admin_note('contest', p_contest, 'closed early');
  return true;
end $$;
