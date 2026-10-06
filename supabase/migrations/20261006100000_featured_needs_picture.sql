-- 037 · A set with no picture yet is not featured (its preview is drawn seconds after
-- publishing; until then a card would show a broken image). Same function as 036 otherwise.
create or replace function public.feed_featured(p_offset integer default 0, p_limit integer default 20)
returns setof public.sets language sql stable security invoker set search_path = '' as $$
  select s.* from public.sets s
   where s.status = 'published' and s.deleted_at is null and s.visibility = 'public'
     and s.preview_image_id is not null
     and s.owner_id <> (select auth.uid())
     and not private.is_muted((select auth.uid()), s.owner_id)
   order by s.featured_at desc nulls last,
            ( (select count(*) from public.likes l where l.set_id = s.id and l.created_at > now() - interval '7 days')
            + (select count(*) from public.reactions r where r.set_id = s.id and r.created_at > now() - interval '7 days')
            + 2 * (select count(*) from public.comments c where c.set_id = s.id and c.deleted_at is null and c.created_at > now() - interval '7 days')
            ) desc,
            s.published_at desc nulls last
   limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;
