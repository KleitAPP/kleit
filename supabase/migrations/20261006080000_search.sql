-- 035 · Search (roadmap M6.1; spec 9 #1–#2): text search over items, sets and people, store
-- pages. Every function here runs as the CALLER (security invoker), so the row policies decide
-- what a search can return: a private set is never a result, a stranger's closet never is, and
-- only cleared products are items (spec 9 #1 "product clips only").

alter table public.items add column search tsvector
  generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(store_name, '') || ' ' || coalesce(source_domain, '') || ' ' || coalesce(color_name, ''))) stored;
create index items_search_idx on public.items using gin (search);
alter table public.sets add column search tsvector
  generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(layout->>'caption', ''))) stored;
create index sets_search_idx on public.sets using gin (search);

-- Words typed → a query that matches prefixes ("boot" finds "boots"), or nothing for blank input.
create or replace function private.search_query(q text)
returns tsquery language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(q, '')) = '' then null
         else to_tsquery('simple', string_agg(lexeme || ':*', ' & '))
         end
    from (select regexp_split_to_table(lower(regexp_replace(btrim(q), '[^[:alnum:][:space:]]', ' ', 'g')), '\s+') as lexeme) w
   where lexeme <> '';
$$;
revoke all on function private.search_query(text) from public;
grant execute on function private.search_query(text) to authenticated;

create or replace function public.search_items(q text, p_store text default null, p_max_cents integer default null, p_limit integer default 40)
returns setof public.items language sql stable security invoker set search_path = '' as $$
  select i.* from public.items i
   where i.kind = 'product'
     and (private.search_query(q) is null or i.search @@ private.search_query(q))
     and (p_store is null or i.source_domain = p_store or i.store_name = p_store)
     and (p_max_cents is null or (i.price_cents is not null and i.price_cents <= p_max_cents))
   order by (case when private.search_query(q) is null then 0 else ts_rank(i.search, private.search_query(q)) end) desc, i.created_at desc
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.search_items(text, text, integer, integer) from public;
grant execute on function public.search_items(text, text, integer, integer) to authenticated;

create or replace function public.search_sets(q text, p_limit integer default 40)
returns setof public.sets language sql stable security invoker set search_path = '' as $$
  select s.* from public.sets s
   where s.status = 'published' and s.deleted_at is null
     and (private.search_query(q) is null or s.search @@ private.search_query(q))
   order by (case when private.search_query(q) is null then 0 else ts_rank(s.search, private.search_query(q)) end) desc, s.published_at desc nulls last
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.search_sets(text, integer) from public;
grant execute on function public.search_sets(text, integer) to authenticated;

-- Stores: every domain with cleared products, and how many (the caller's own read policy decides
-- which rows count, so a stranger's uncleared clip never adds to a store).
create or replace function public.stores(p_limit integer default 50)
returns table (domain text, store_name text, products bigint)
language sql stable security invoker set search_path = '' as $$
  select i.source_domain, max(i.store_name), count(*)
    from public.items i
   where i.kind = 'product' and i.source_domain is not null
   group by i.source_domain
   order by count(*) desc, i.source_domain
   limit least(greatest(p_limit, 1), 200);
$$;
revoke all on function public.stores(integer) from public;
grant execute on function public.stores(integer) to authenticated;
