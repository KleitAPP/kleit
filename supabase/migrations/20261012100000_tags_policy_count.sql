-- 096 · One correction to 095: it rebuilt the "owner tags" policy from 082's text, which counts
-- the set's tags with a subquery on its own table and recurses - 083 had already moved that
-- count into private.tags_on_set (L31, again: the policy's latest text was in 083, not 082).
-- This is 083's policy plus 095's one change (a banned account is never tagged).
drop policy "set_tags: owner tags" on public.set_tags;
create policy "set_tags: owner tags" on public.set_tags for insert to authenticated
  with check (
    tagged_by = (select auth.uid())
    and (select private.owns_set(set_id))
    and user_id <> (select auth.uid())
    and not (select private.blocked_either_way((select auth.uid()), user_id))
    and exists (select 1 from public.profiles p
                 where p.user_id = set_tags.user_id and p.deactivated_at is null and p.banned_at is null
                   and p.mention_setting <> 'nobody')
    and (select private.tags_on_set(set_id)) < 10
  );
