-- 114 · The appeals policy of 113, from its latest text this time (L31: 113 started from 055's
-- policy and dropped 068/069's "note = '' and decided_at is null and decided_by is null", which
-- test 051 proves; and the photo branch read item_flags as the person, who has no policy on it,
-- so every photo appeal was refused - test 089). The flag question is asked by a definer.
create or replace function private.photo_appealable(p_item uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i join public.item_flags f on f.item_id = i.id
     where i.id = p_item and i.owner_id = p_user and p_user is not null
       and i.deleted_at is null and i.takedown_state = 'none'
       and f.scan_state = 'blocked'
       and coalesce(f.labels ->> 'reason', '') not in ('too-large', 'animated')
  );
$$;
revoke all on function private.photo_appealable(uuid, uuid) from public;
grant execute on function private.photo_appealable(uuid, uuid) to authenticated;

drop policy "appeals: the struck person appeals once" on public.appeals;
-- One appeal per strike, by the person struck, while the strike is live; one per photo, by its
-- owner, while the scanner's (or a moderator's) block stands. The moderator's columns stay empty.
create policy "appeals: the struck person appeals once" on public.appeals for insert to authenticated
  with check (
    user_id = (select auth.uid()) and state = 'open' and note = '' and decided_at is null and decided_by is null
    and (
      (strike_id is not null and exists (
         select 1 from public.strikes s where s.id = appeals.strike_id and s.user_id = (select auth.uid()) and s.expires_at > now()))
      or
      (item_id is not null and (select private.photo_appealable(appeals.item_id, (select auth.uid()))))
    )
  );
