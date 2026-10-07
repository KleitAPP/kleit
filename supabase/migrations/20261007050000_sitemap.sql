-- 056 · The sitemap's one question (spec 8.4 #5: "sitemap built from public sets"). The Worker
-- serves /sitemap.xml from this list: share codes and dates of sets a search engine may index -
-- published, Public (never Link-only or narrower), not deleted or taken down, owner not hidden.
-- A share code of a Public set is already on its page; nothing else leaves.
create or replace function public.public_set_codes(p_limit integer default 5000)
returns table (share_code text, published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.share_code, s.published_at
    from public.sets s
   where s.status = 'published'
     and s.visibility = 'public'
     and s.deleted_at is null
     and s.takedown_state = 'none'
     and not (select private.is_hidden_account(s.owner_id))
   order by s.published_at desc nulls last
   limit least(greatest(coalesce(p_limit, 1), 1), 50000);
$$;
revoke all on function public.public_set_codes(integer) from public;
grant execute on function public.public_set_codes(integer) to anon, authenticated;
