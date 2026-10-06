-- 041 · Tags (roadmap M6.1, S89 the tag page; spec 9 #1). A set may carry up to twenty tags
-- (migration 017 already caps the count); this adds the shape - lowercase letters, digits and
-- hyphens, 1–30 characters, no duplicates - a GIN index, the tag page's read, the popular
-- list, and tags in the set search. All reads run as the caller, so a tag never reveals a set
-- the caller could not open anyway.

create or replace function private.tags_ok(p_tags text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((
    select bool_and(tag ~ '^[a-z0-9][a-z0-9-]{0,29}$') and count(*) = count(distinct tag)
      from unnest(p_tags) as tag
  ), true);
$$;
alter table public.sets add constraint sets_tags_shape check (private.tags_ok(tags));
create index sets_tags_idx on public.sets using gin (tags);

-- Tags join the set search: drop the generated column from 035 and make it again with tags in.
-- (array_to_string is only STABLE to Postgres; a generated column needs IMMUTABLE, so it is
-- wrapped in a function that promises it - the output of text[] → text never changes.)
create or replace function private.tags_text(p_tags text[])
returns text language sql immutable set search_path = '' as $$
  select coalesce(array_to_string(p_tags, ' '), '');
$$;
drop index if exists public.sets_search_idx;
alter table public.sets drop column search;
alter table public.sets add column search tsvector
  generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(layout->>'caption', '') || ' ' || private.tags_text(tags))) stored;
create index sets_search_idx on public.sets using gin (search);

create or replace function public.sets_by_tag(p_tag text, p_limit integer default 40)
returns setof public.sets language sql stable security invoker set search_path = '' as $$
  select s.* from public.sets s
   where s.status = 'published' and s.deleted_at is null
     and s.tags @> array[lower(btrim(p_tag))]
   order by s.published_at desc nulls last
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.sets_by_tag(text, integer) from public;
grant execute on function public.sets_by_tag(text, integer) to authenticated;

create or replace function public.popular_tags(p_limit integer default 30)
returns table (tag text, sets bigint)
language sql stable security invoker set search_path = '' as $$
  select t.tag, count(*)
    from public.sets s, unnest(s.tags) as t(tag)
   where s.status = 'published' and s.deleted_at is null
   group by t.tag
   order by count(*) desc, t.tag
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.popular_tags(integer) from public;
grant execute on function public.popular_tags(integer) to authenticated;
