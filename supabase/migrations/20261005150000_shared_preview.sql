-- Migration 023 — the shared page and the poll page carry the set's chat picture (CL30).
-- `shared_set` and `shared_poll` (migrations 021, 022) gain one field, `preview`: the versioned
-- path in the public `set-previews` bucket that the set-preview function wrote, or null. Nothing
-- else changes; a new file because the applied ones are never edited (L25).
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

create or replace function public.shared_poll(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id,
    'question', p.question,
    'closes_at', p.closes_at,
    'closed', p.closed_at is not null or p.closes_at <= now(),
    'owner', jsonb_build_object('username', pr.username, 'display_name', pr.display_name),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'label', o.label,
        'sort_order', o.sort_order,
        'set', jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'layout', s.layout,
          'preview', case when s.status = 'published' and s.visibility in ('public', 'link') then s.preview_image_id end,
          'pieces', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', i.id,
              'slot', (si.position ->> 'slot')::int,
              'kind', i.kind,
              'title', i.title,
              'price_cents', case when i.kind = 'product' then i.price_cents end,
              'price_currency', case when i.kind = 'product' then i.price_currency end,
              'pictured', (select private.image_cleared(i.id))
                          and (i.kind = 'product' or (select private.closet_says_shareable(i.id)))
            ) order by (si.position ->> 'slot')::int)
            from public.set_items si join public.items i on i.id = si.item_id
            where si.set_id = s.id and i.deleted_at is null and i.takedown_state = 'none'
          ), '[]'::jsonb)
        )
      ) order by o.sort_order)
      from public.poll_options o
      join public.sets s on s.id = o.set_id
      where o.poll_id = p.id and s.deleted_at is null and s.takedown_state = 'none'
    ), '[]'::jsonb)
  )
  from public.polls p
  join public.profiles pr on pr.user_id = p.owner_id
  where p.share_code = p_code and p.deleted_at is null and p.takedown_state = 'none'
  limit 1;
$$;
