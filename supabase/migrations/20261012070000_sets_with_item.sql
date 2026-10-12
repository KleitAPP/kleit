-- 093 · "Sets with this item" (spec 9 #2; design pack S40, G2). The count has existed since 017
-- (`public_item_stats`, public published sets only - a wider count would leak the existence of
-- private sets); the list is the same rule as a function: public, published, not deleted or
-- taken down, newest first. Security invoker, so the caller's own read policies still apply on
-- top (a set across a block, or by a hidden account, is simply not there).

create or replace function public.sets_with_item(p_item uuid, p_limit integer default 24)
returns setof public.sets language sql stable security invoker set search_path = '' as $$
  select s.* from public.sets s
   where s.status = 'published' and s.visibility = 'public'
     and s.deleted_at is null and s.takedown_state = 'none'
     and exists (select 1 from public.set_items si where si.set_id = s.id and si.item_id = p_item)
   order by s.published_at desc nulls last
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.sets_with_item(uuid, integer) from public, anon;
grant execute on function public.sets_with_item(uuid, integer) to authenticated;
