-- 055 · A hidden account's share links go dark too (spec 3.6 #8: a break, a suspension or a
-- pending deletion "hides everything at once"). `can_view_set` learnt this in 051, but the two
-- guest doors the Worker uses - `set_by_share_code` under `shared_set`, and `shared_poll` - did
-- not, so a public link kept working for a banned or deleting owner. Both now answer null, the
-- same as a wrong code. Each function is the latest version in the repo (L31) plus one line.

create or replace function public.set_by_share_code(p_code text)
returns setof public.sets
language sql stable security definer set search_path = '' as $$
  select s.* from public.sets s
  where s.share_code = p_code
    and s.status = 'published'
    and s.deleted_at is null
    and s.takedown_state = 'none'
    and s.visibility in ('public', 'link')
    and not (select private.is_hidden_account(s.owner_id))
    and not (select private.blocked_either_way((select auth.uid()), s.owner_id))
  limit 1;
$$;
-- Still not callable directly (migration 024): only through the curated page functions.
revoke all on function public.set_by_share_code(text) from public, anon, authenticated;

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
    and not (select private.is_hidden_account(p.owner_id))
  limit 1;
$$;
revoke all on function public.shared_poll(text) from public;
grant execute on function public.shared_poll(text) to anon, authenticated;
