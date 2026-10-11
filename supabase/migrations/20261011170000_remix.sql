-- 079 · Remix (spec 7.4; design pack S48's "remix"; the columns waited since 013). Someone's
-- set becomes a new draft of yours - the same layout and the same pieces you are allowed to
-- use - with a credit that cannot be removed: "Remixed from @name", or "Remixed from a deleted
-- account" once they are gone (051 already writes that).
--
-- Who may remix a set is the set's own `remix_mode` (anyone / followers / off), the owner's
-- call, changed from the set's options. A blocked person cannot, whatever the mode; neither
-- can anyone who could not see the set in the first place. The owner is told (a notification of
-- kind `remix`; a push like a comment).
--
-- What is copied: the layout (a Quick template or a Creative canvas), minus any words set in a
-- private font (the font file never leaves its owner's account - decision 9); every piece the
-- remixer may put on a set of their own - a cleared product, or an own piece its closet row has
-- made shareable (`piece_is_shareable`, the share page's own rule). Pieces that are not come
-- off, and the function says how many so the screen can.

alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided', 'remix'));

create or replace function public.remix_set(p_set_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  src public.sets%rowtype;
  owner_name text;
  new_id uuid;
  v_layout jsonb;
  texts jsonb := '{}'::jsonb;
  k text; v jsonb;
  copied integer := 0;
  skipped integer := 0;
  r record;
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  select * into src from public.sets s where s.id = p_set_id;
  if src.id is null or src.deleted_at is not null or src.takedown_state <> 'none' or src.status <> 'published'
     or not (select public.can_view_set(p_set_id, me)) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if src.owner_id <> me then
    if (select private.blocked_either_way(me, src.owner_id)) then raise exception 'not_found' using errcode = 'P0002'; end if;
    if src.remix_mode = 'off' then raise exception 'remix_off' using errcode = 'P0001'; end if;
    if src.remix_mode = 'followers' and not (select private.is_following(me, src.owner_id)) then
      raise exception 'remix_followers' using errcode = 'P0001';
    end if;
  end if;
  select p.username into owner_name from public.profiles p where p.user_id = src.owner_id;

  -- The layout, minus words in a private font.
  v_layout := coalesce(src.layout, '{}'::jsonb);
  if v_layout ? 'texts' and jsonb_typeof(v_layout -> 'texts') = 'object' then
    for k, v in select * from jsonb_each(v_layout -> 'texts') loop
      if not (coalesce(v #>> '{text,font}', '') like 'private:%') then texts := texts || jsonb_build_object(k, v); end if;
    end loop;
    v_layout := jsonb_set(v_layout, '{texts}', texts);
  end if;
  v_layout := v_layout - 'caption' || jsonb_build_object('caption', '');

  perform set_config('kleit.server_write', '1', true);
  insert into public.sets (owner_id, title, caption, status, visibility, layout, remixed_from_set_id, remixed_from_label)
  values (me, '', '', 'draft', 'public', v_layout,
          case when src.owner_id = me then null else src.id end,
          case when src.owner_id = me then null else 'Remixed from @' || coalesce(owner_name, 'someone') end)
  returning id into new_id;
  perform set_config('kleit.server_write', '0', true);

  for r in select si.item_id, si.position from public.set_items si where si.set_id = src.id loop
    if (select i.owner_id = me from public.items i where i.id = r.item_id) or (select public.piece_is_shareable(r.item_id)) then
      insert into public.set_items (set_id, item_id, position) values (new_id, r.item_id, r.position);
      copied := copied + 1;
    else
      skipped := skipped + 1;
    end if;
  end loop;

  if src.owner_id <> me then
    perform private.notify(src.owner_id, 'remix', me, 'set', new_id);
  end if;
  return jsonb_build_object('id', new_id, 'copied', copied, 'skipped', skipped,
                            'creative', coalesce((v_layout ->> 'version')::int, 1) = 2);
end $$;
revoke all on function public.remix_set(uuid) from public, anon;
grant execute on function public.remix_set(uuid) to authenticated;

-- The credit is the server's: a remixer cannot erase or rewrite it (spec 7.4 #1). The guard
-- from 036 (featured_at) with the two credit columns added (L31: the latest definition).
create or replace function private.sets_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin())
     or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.takedown_state is distinct from old.takedown_state
     or new.share_code is distinct from old.share_code
     or new.featured_at is distinct from old.featured_at
     or new.remixed_from_set_id is distinct from old.remixed_from_set_id
     or new.remixed_from_label is distinct from old.remixed_from_label then
    raise exception 'owner_id, takedown_state, share_code, featured_at and the remix credit are set by the server only';
  end if;
  if new.status = 'published' and old.status = 'draft' then
    new.published_at := coalesce(old.published_at, now());
  end if;
  return new;
end;
$$;

-- And never claimed on the way in: a member's own insert carries no credit, no feature and no
-- takedown state (the way 065 guards an items insert).
create or replace function private.sets_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin())
     or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.remixed_from_set_id is not null or new.remixed_from_label is not null
     or new.featured_at is not null or new.takedown_state <> 'none' then
    raise exception 'the remix credit, featured_at and takedown_state are set by the server only' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists sets_insert_guard on public.sets;
create trigger sets_insert_guard before insert on public.sets
  for each row execute function private.sets_insert_guard();

-- The share page carries the credit too (the latest shared_set, from 025, plus one field).
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
    'remixed_from', s.remixed_from_label,
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
