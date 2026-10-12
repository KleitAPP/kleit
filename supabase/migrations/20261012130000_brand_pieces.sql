-- 099 · The brand mini editor's one question (roadmap M9.2; spec 16.5 #1, S109; OW23 option a).
--
-- A brand's own site embeds a small editor over the pieces Kleit already has from that store
-- (`/e/brand/<domain>`, worker/index.ts). The page is for anyone, so this is a guest door like
-- `shared_set`: it answers with the public key and says only what a guest may see.
--
-- What a store's page lists: cleared store pieces (`kind = 'product'`, the scan says clean),
-- that are not deleted or taken down, whose store page still answers (no `dead_link_at`) and
-- that are not marked sold out - a shop window shows what can be bought. One row per picture:
-- several people clipping the same product give the same `image_hash`, and the newest clip
-- stands for all of them. Newest first, at most 48.
--
-- What it never says: who clipped a piece. There is no owner in the answer, by design.
--
-- The domain is the lower-case host without `www.`, the way `clip-url` records it; anything
-- that is not that shape answers null, the same as a store nobody has clipped from.
create or replace function public.brand_pieces(p_domain text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_domain is null
      or p_domain !~ '^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$'
      or position('.' in p_domain) = 0
    then null
    else jsonb_build_object(
      'id', p_domain,
      'domain', p_domain,
      'pieces', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', x.id,
          'title', x.title,
          'price_cents', x.price_cents,
          'price_currency', x.price_currency
        ) order by x.created_at desc, x.id)
        from (
          select d.id, d.title, d.price_cents, d.price_currency, d.created_at
          from (
            select distinct on (coalesce(i.image_hash, i.id::text))
                   i.id, i.title, i.price_cents, i.price_currency, i.created_at
              from public.items i
             where i.kind = 'product'
               and i.source_domain = p_domain
               and i.deleted_at is null
               and i.takedown_state = 'none'
               and i.source_url is not null
               and i.dead_link_at is null
               and not i.sold_out
               and (select private.image_cleared(i.id))
             order by coalesce(i.image_hash, i.id::text), i.created_at desc
          ) d
          order by d.created_at desc, d.id
          limit 48
        ) x
      ), '[]'::jsonb)
    )
  end;
$$;
comment on function public.brand_pieces(text) is 'The brand mini editor''s pieces for one store (migration 099): cleared, buyable store pieces, one per picture, newest 48, no owner named.';
revoke all on function public.brand_pieces(text) from public;
grant execute on function public.brand_pieces(text) to anon, authenticated;
