-- 090 · Labels for staff, stylist and brand accounts (spec 11 #9 "staff, stylist and brand posts
-- are labeled"; 23.3 #2 the starter sets are posted under labelled Kleit Stylists accounts, never
-- fake users; 16.5 #4 "Sponsored" labels for brands). One column on the profile, set by an admin
-- through one door and written to the audit log, read by everyone who can read the profile: the
-- profile page, feed cards, the set page and the share page say "Kleit staff", "Kleit stylist"
-- or "Brand" next to the name. The label is the server's: a member can neither set it on their
-- own row nor claim one on the way in - and the same guard now covers points and a ban on an
-- insert, which only the update guard had watched.
--
-- Replaced from their latest definitions (L31): profiles_points_guard (048), shared_set (079).

create type public.account_label as enum ('none', 'staff', 'stylist', 'brand');
alter table public.profiles add column label public.account_label not null default 'none';

-- The update guard (048), plus the label.
create or replace function private.profiles_points_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.points is distinct from old.points or new.banned_at is distinct from old.banned_at
     or new.label is distinct from old.label then
    raise exception 'points, bans and labels are written by the server only' using errcode = '42501';
  end if;
  if old.deactivated_at is not null and new.deactivated_at is null
     and exists (select 1 from public.account_deletions d where d.user_id = old.user_id and d.state = 'pending') then
    raise exception 'deletion pending: undo it first' using errcode = 'P0005';
  end if;
  return new;
end $$;

-- And the same columns on the way in: a member's own profile row starts at zero, unbanned and
-- unlabelled, whether it comes through claim_profile or straight at the table.
create or replace function private.profiles_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.points <> 0 or new.banned_at is not null or new.label <> 'none' then
    raise exception 'points, bans and labels are written by the server only' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.profiles_insert_guard() from public;
drop trigger if exists profiles_insert_guard on public.profiles;
create trigger profiles_insert_guard before insert on public.profiles
  for each row execute function private.profiles_insert_guard();

alter table public.admin_audit_log drop constraint admin_audit_what;
alter table public.admin_audit_log add constraint admin_audit_what
  check (what in ('dm_evidence', 'user_lookup', 'switch', 'ban', 'unban', 'private_view', 'contest', 'feature', 'invite', 'label'));

-- The door: an admin labels an account by username. Logged with the old and new label.
create or replace function public.set_account_label(p_username text, p_label public.account_label)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_was public.account_label;
begin
  perform private.require_admin();
  select p.user_id, p.label into v_user, v_was from public.profiles p where p.username = lower(btrim(p_username));
  if v_user is null then return false; end if;
  if v_was = p_label then return true; end if;
  perform set_config('kleit.server_write', '1', true);
  update public.profiles set label = p_label where user_id = v_user;
  perform set_config('kleit.server_write', '0', true);
  perform private.admin_note('label', v_user, v_was::text || ' → ' || p_label::text);
  return true;
end $$;
revoke all on function public.set_account_label(text, public.account_label) from public, anon;
grant execute on function public.set_account_label(text, public.account_label) to authenticated;

-- The share page and the embed carry the label (the latest shared_set, from 079, plus one field).
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
    'owner', jsonb_build_object('username', p.username, 'display_name', p.display_name, 'label', p.label),
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
