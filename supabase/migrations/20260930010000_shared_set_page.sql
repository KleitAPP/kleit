-- Migration 021 — what a guest may see of a shared set, in one function (roadmap M3.3, M3.5;
-- spec 8.2; technical pack §2 rule 3).
--
-- A person with no account never gets a database connection: they get the share Worker, which
-- asks this function with the share code and the anon key. The function answers with the set
-- and its pieces only when `set_by_share_code` (migration 017) would - published, not deleted,
-- not taken down, public or link - and with nothing about the owner beyond their username and
-- display name (the creator card, spec 8.2 #3). A wrong code, a private set and a draft all
-- come back as no rows, which is the same answer.
--
-- Pieces: a product's picture goes through the item-image gate (cleared products only); a
-- person's own piece shows its name and is pictured only if the closet says it may be shared
-- and screening has cleared it. Prices and Buy come with the product; nothing else does.
create or replace function public.shared_set(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'title', s.title,
    'caption', coalesce(s.layout ->> 'caption', ''),
    'layout', s.layout,
    'visibility', s.visibility,
    'published_at', s.published_at,
    'owner', jsonb_build_object('username', p.username, 'display_name', p.display_name),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'slot', (si.position ->> 'slot')::int,
        'kind', i.kind,
        'title', i.title,
        'price_cents', case when i.kind = 'product' then i.price_cents end,
        'price_currency', case when i.kind = 'product' then i.price_currency end,
        'store_name', case when i.kind = 'product' then coalesce(i.store_name, i.source_domain) end,
        'source_domain', case when i.kind = 'product' then i.source_domain end,
        'buyable', i.kind = 'product' and i.source_url is not null,
        'pictured', (select private.image_cleared(i.id))
                    and (i.kind = 'product' or (select private.closet_says_shareable(i.id)))
      ) order by (si.position ->> 'slot')::int)
      from public.set_items si
      join public.items i on i.id = si.item_id
      where si.set_id = s.id and i.deleted_at is null and i.takedown_state = 'none'
    ), '[]'::jsonb)
  )
  from public.set_by_share_code(p_code) s
  join public.profiles p on p.user_id = s.owner_id
  limit 1;
$$;
revoke all on function public.shared_set(text) from public;
grant execute on function public.shared_set(text) to anon, authenticated;

-- The picture of a shareable own piece on a shared set, for the item-image gate: a product is
-- served on its own merits; an own piece only when its closet row says shareable and it sits on
-- a set the world may see. The gate function (item-image) asks this.
create or replace function public.piece_is_shareable(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i
    where i.id = p_item_id and i.deleted_at is null and i.takedown_state = 'none'
      and (select private.image_cleared(i.id))
      and (
        i.kind = 'product'
        or ((select private.closet_says_shareable(i.id)) and exists (
          select 1 from public.set_items si join public.sets s on s.id = si.set_id
          where si.item_id = i.id and s.status = 'published' and s.deleted_at is null
            and s.takedown_state = 'none' and s.visibility in ('public', 'link')
        ))
      )
  );
$$;
revoke all on function public.piece_is_shareable(uuid) from public, anon, authenticated;
grant execute on function public.piece_is_shareable(uuid) to service_role;
