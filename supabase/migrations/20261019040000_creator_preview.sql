-- 106: the creator preview on the share page (spec 8.2 #3; CL63). shared_set's owner carries
-- `set_count` - the owner's published, public, live sets, which is exactly what a visitor would
-- see after signing up ("Sign up to see all their sets"). Nothing else in the function changes
-- (the whole definition is restated: L31).
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
    'description', coalesce(s.description, ''),
    'layout', s.layout,
    'visibility', s.visibility,
    'published_at', s.published_at,
    'edited_at', s.edited_at,
    'alt_text', s.alt_text,
    'preview', s.preview_image_id,
    'remixed_from', s.remixed_from_label,
    'owner', jsonb_build_object('username', p.username, 'display_name', p.display_name, 'label', p.label,
                                'photo', case when (select public.piece_is_shareable(p.avatar_item_id)) then p.avatar_item_id end,
                                'set_count', (select count(*) from public.sets o
                                              where o.owner_id = p.user_id and o.status = 'published' and o.visibility = 'public'
                                                and o.deleted_at is null and o.takedown_state = 'none')),
    'song', case when s.song_url is not null then jsonb_build_object(
              'url', s.song_url, 'title', s.song_title, 'artist', s.song_artist, 'cover', s.song_cover_url) end,
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'row', si.id,
        'slot', (si.position ->> 'slot')::int,
        'position', case when si.position ? 'x' then si.position end,
        'kind', i.kind,
        'title', i.title,
        'color_name', i.color_name,
        'price_cents', case when i.kind = 'product' then i.price_cents end,
        'price_currency', case when i.kind = 'product' then i.price_currency end,
        'store_name', case when i.kind = 'product' then coalesce(i.store_name, i.source_domain) end,
        'source_domain', case when i.kind = 'product' then i.source_domain end,
        'buyable', i.kind = 'product' and i.source_url is not null and i.dead_link_at is null
                   and (select private.image_cleared(i.id)),
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
