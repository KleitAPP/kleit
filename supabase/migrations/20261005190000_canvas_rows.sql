-- Migration 025 — the Creative canvas (roadmap M4.2; spec 6.1 #4).
--
-- A clone is the same piece twice on one set, so a set may hold an item more than once: the
-- (set_id, item_id) uniqueness from migration 017 goes, and the row id becomes the layer id.
-- The quick builder never relied on it (placeItem clears the slot first) and the shared page
-- lists pieces by row. The shared page also learns each piece's position, so a Creative set is
-- drawn where its owner put things rather than in a template's slots.
alter table public.set_items drop constraint if exists set_items_set_id_item_id_key;
create index if not exists set_items_set_item_idx on public.set_items (set_id, item_id);

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
    'preview', s.preview_image_id,
    'owner', jsonb_build_object('username', p.username, 'display_name', p.display_name),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'row', si.id,
        'slot', (si.position ->> 'slot')::int,
        'position', case when si.position ? 'x' then si.position end,
        'kind', i.kind,
        'title', i.title,
        'price_cents', case when i.kind = 'product' then i.price_cents end,
        'price_currency', case when i.kind = 'product' then i.price_currency end,
        'store_name', case when i.kind = 'product' then coalesce(i.store_name, i.source_domain) end,
        'source_domain', case when i.kind = 'product' then i.source_domain end,
        'buyable', i.kind = 'product' and i.source_url is not null,
        'pictured', (select private.image_cleared(i.id))
                    and (i.kind = 'product' or (select private.closet_says_shareable(i.id)))
      ) order by (si.position ->> 'slot')::int, si.created_at)
      from public.set_items si
      join public.items i on i.id = si.item_id
      where si.set_id = s.id and i.deleted_at is null and i.takedown_state = 'none'
    ), '[]'::jsonb)
  )
  from public.set_by_share_code(p_code) s
  join public.profiles p on p.user_id = s.owner_id
  limit 1;
$$;
