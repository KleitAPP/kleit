-- 101 · The read-back of the quick builder's helpers (L35): `search_items` (035) runs as the
-- caller, and the caller's own `items` rows are readable in every state - so a person's own
-- clip that is deleted, taken down, still being checked or refused came back from a store
-- search, and Complete the look could put it on a set where nobody else sees it. The pieces
-- search answers are now live ones only: not deleted, not taken down. (Whether a piece is
-- cleared is still the caller's `my_items_scan_states` to ask, for their own rows; another
-- person's row is only readable once cleared. A piece whose store page is gone stays: it is
-- still a picture somebody clipped, only Buy is hidden.) 035's text plus the two conditions.
create or replace function public.search_items(q text, p_store text default null, p_max_cents integer default null, p_limit integer default 40)
returns setof public.items language sql stable security invoker set search_path = '' as $$
  select i.* from public.items i
   where i.kind = 'product'
     and i.deleted_at is null
     and i.takedown_state = 'none'
     and (private.search_query(q) is null or i.search @@ private.search_query(q))
     and (p_store is null or i.source_domain = p_store or i.store_name = p_store)
     and (p_max_cents is null or (i.price_cents is not null and i.price_cents <= p_max_cents))
   order by (case when private.search_query(q) is null then 0 else ts_rank(i.search, private.search_query(q)) end) desc, i.created_at desc
   limit least(greatest(p_limit, 1), 100);
$$;
