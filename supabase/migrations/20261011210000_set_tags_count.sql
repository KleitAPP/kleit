-- 083 · One correction to 082: the tag policy counted the set's tags with a subquery on its own
-- table, which runs under the same policy and recurses (the shape 018 and 019 taught, L25). The
-- count moves into a function that reads as its owner.
create or replace function private.tags_on_set(p_set_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.set_tags t where t.set_id = p_set_id;
$$;
revoke all on function private.tags_on_set(uuid) from public;
grant execute on function private.tags_on_set(uuid) to authenticated;

drop policy "set_tags: owner tags" on public.set_tags;
create policy "set_tags: owner tags" on public.set_tags for insert to authenticated
  with check (
    tagged_by = (select auth.uid())
    and (select private.owns_set(set_id))
    and user_id <> (select auth.uid())
    and not (select private.blocked_either_way((select auth.uid()), user_id))
    and exists (select 1 from public.profiles p where p.user_id = set_tags.user_id and p.deactivated_at is null and p.mention_setting <> 'nobody')
    and (select private.tags_on_set(set_id)) < 10
  );
