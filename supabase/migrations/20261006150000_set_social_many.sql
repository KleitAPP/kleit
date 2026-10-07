-- 042 · The counts for a page of cards in one call (CL38): likes, comments and whether the
-- caller liked each set. Security invoker, so a set the caller cannot open counts nothing.
create or replace function public.set_social_many(p_ids uuid[])
returns table (set_id uuid, likes bigint, comments bigint, my_like boolean)
language sql stable security invoker set search_path = '' as $$
  select s.id,
         (select count(*) from public.likes l where l.set_id = s.id),
         (select count(*) from public.comments c where c.set_id = s.id and c.deleted_at is null),
         exists (select 1 from public.likes l where l.set_id = s.id and l.user_id = (select auth.uid()))
    from public.sets s
   where s.id = any (p_ids)
   limit 100;
$$;
revoke all on function public.set_social_many(uuid[]) from public;
grant execute on function public.set_social_many(uuid[]) to authenticated;
