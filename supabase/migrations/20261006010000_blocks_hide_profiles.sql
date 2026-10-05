-- 028 · A blocked person cannot find or view you (roadmap M5.5; spec 10.4 #1).
--
-- Migration 001's profiles read policy knew nothing of blocks (they did not exist yet). Now a
-- profile is hidden in both directions across a block - the blocked person cannot find the
-- blocker, and the blocker does not see the blocked person in lists either (the blocked list in
-- Settings reads through `blocked_people()`, which runs as the data's owner). Your own row is
-- always yours. Nobody is told (spec 10.4 #2).

drop policy "profiles: signed-in read" on public.profiles;
create policy "profiles: signed-in read" on public.profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (deactivated_at is null and not (select private.blocked_either_way((select auth.uid()), user_id)))
  );

-- The blocked list (Settings > Blocked accounts, spec 10.4 #4): names and ids of the people I
-- blocked, which the policy above would otherwise hide from me too.
create or replace function public.blocked_people()
returns table (user_id uuid, username text, display_name text, blocked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username, p.display_name, b.created_at
    from public.blocks b
    join public.profiles p on p.user_id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$$;
revoke all on function public.blocked_people() from public;
grant execute on function public.blocked_people() to authenticated;

-- A conversation across a block disappears for both (the rows stay for a report, spec 10.2 #8).
drop policy "conversations: members read" on public.conversations;
create policy "conversations: members read" on public.conversations for select to authenticated
  using (
    (user_a = (select auth.uid()) or user_b = (select auth.uid()))
    and not (select private.blocked_either_way(user_a, user_b))
  );
