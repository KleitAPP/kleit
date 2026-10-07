-- 051 · Deleting an account (roadmap M7; spec 3.7; S24). Everything is hidden at once; seven
-- days to change your mind by signing in and pressing Undo; then the nightly job makes it
-- final: comments go, votes stay in totals unlinked, their messages read "Message unavailable",
-- other people's remixes stay as "Remixed from a deleted account", clipped store pieces stay in
-- the catalogue with no owner, their own photos go, and the username is free at once.
--
-- The emails at the start and the end (spec 3.7 #3) wait for the mail sender on the server
-- (Brevo is wired to sign-in mail only; CL43).

-- Clipped store pieces outlive their clipper; a photo of their own does not.
alter table public.items alter column owner_id drop not null;
alter table public.items drop constraint items_owner_id_fkey;
alter table public.items add constraint items_owner_id_fkey foreign key (owner_id) references auth.users (id) on delete set null;
-- Their messages stay as "unavailable" rather than vanishing from the other person's screen.
alter table public.messages alter column sender_id drop not null;
alter table public.messages drop constraint messages_sender_id_fkey;
alter table public.messages add constraint messages_sender_id_fkey foreign key (sender_id) references auth.users (id) on delete set null;

-- A hidden account (on a break, suspended, or being deleted) hides its sets too (spec 3.6 #8).
create or replace function private.is_hidden_account(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = p_user and (p.banned_at is not null or p.deactivated_at is not null));
$$;
revoke all on function private.is_hidden_account(uuid) from public;
grant execute on function private.is_hidden_account(uuid) to authenticated, anon;

create or replace function public.can_view_set(p_set_id uuid, p_viewer uuid, p_code text default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sets s
    where s.id = p_set_id
      and s.takedown_state = 'none'
      and (
        s.owner_id = p_viewer
        or (
          s.status = 'published'
          and s.deleted_at is null
          and not (select private.is_hidden_account(s.owner_id))
          and not (select private.blocked_either_way(p_viewer, s.owner_id))
          and (
            s.visibility = 'public'
            or (s.visibility = 'link' and p_code is not null and s.share_code = p_code)
            or (s.visibility = 'public' and p_code is not null and s.share_code = p_code)
            or (s.visibility = 'followers' and (select private.is_following(p_viewer, s.owner_id)))
            or (s.visibility = 'friends' and (select private.are_friends(p_viewer, s.owner_id)))
          )
        )
      )
  );
$$;

-- Asking: hide everything now, final in seven days. Asking again while pending changes nothing.
create or replace function public.request_account_deletion()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); was text; final timestamptz;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into public.account_deletions (user_id, state, requested_at, final_at, cancelled_at)
  values (me, 'pending', now(), now() + interval '7 days', null)
  on conflict (user_id) do update set state = 'pending', requested_at = now(), final_at = now() + interval '7 days', cancelled_at = null
    where public.account_deletions.state <> 'pending';
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.profiles set deactivated_at = coalesce(deactivated_at, now()) where user_id = me;
  perform set_config('kleit.server_write', was, true);
  select final_at into final from public.account_deletions where user_id = me;
  return final;
end $$;
revoke all on function public.request_account_deletion() from public;
grant execute on function public.request_account_deletion() to authenticated;

create or replace function public.cancel_account_deletion()
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); was text; n integer;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  update public.account_deletions set state = 'cancelled', cancelled_at = now() where user_id = me and state = 'pending';
  get diagnostics n = row_count;
  if n = 1 then
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    update public.profiles set deactivated_at = null where user_id = me;
    perform set_config('kleit.server_write', was, true);
  end if;
  return n = 1;
end $$;
revoke all on function public.cancel_account_deletion() from public;
grant execute on function public.cancel_account_deletion() to authenticated;

-- Signing in ends a break (the app clears deactivated_at) - but not while a deletion is pending:
-- Undo is the only way back, so the person sees what they are undoing.
create or replace function private.profiles_points_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.points is distinct from old.points or new.banned_at is distinct from old.banned_at then
    raise exception 'points and bans are written by the server only' using errcode = '42501';
  end if;
  if old.deactivated_at is not null and new.deactivated_at is null
     and exists (select 1 from public.account_deletions d where d.user_id = old.user_id and d.state = 'pending') then
    raise exception 'deletion pending: undo it first' using errcode = 'P0005';
  end if;
  return new;
end $$;

-- Final: the nightly job. Everything the spec promises, then the auth row itself goes and
-- takes the rest by cascade (profile, sets, comments, likes, follows, notifications, points).
create or replace function private.finalize_account_deletions()
returns integer language plpgsql security definer set search_path = '' as $$
declare d record; n integer := 0;
begin
  perform set_config('kleit.server_write', '1', true);
  for d in select user_id from public.account_deletions where state = 'pending' and final_at <= now() loop
    -- Remixes of their sets stay, credited to a deleted account (spec 3.7 #8).
    update public.sets set remixed_from_set_id = null, remixed_from_label = 'Remixed from a deleted account'
     where remixed_from_set_id in (select id from public.sets where owner_id = d.user_id);
    -- Their own photos go; clipped store pieces stay with no owner (the FK sets null on cascade).
    update public.items set deleted_at = coalesce(deleted_at, now()), takedown_state = 'removed' where owner_id = d.user_id and kind = 'own';
    -- Their messages read "unavailable" (the FK sets the sender null; mark them too).
    update public.messages set deleted_at = coalesce(deleted_at, now()) where sender_id = d.user_id;
    -- The 18+ record forgets when to purge: 30 more days (spec 3.7 #4).
    update public.age_confirmations set purge_after = now() + interval '30 days' where user_id_hash = encode(sha256(d.user_id::text::bytea), 'hex') and purge_after is null;
    update public.account_deletions set state = 'completed' where user_id = d.user_id;
    delete from auth.users where id = d.user_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.finalize_account_deletions() from public;

-- Into the nightly job.
create or replace function private.nightly_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_sets int; n_votes_ip int; n_votes_dev int; n_clicks int; n_notes int; n_msgs int; n_ev int; n_acc int;
begin
  perform set_config('kleit.server_write', '1', true);
  n_acc := private.finalize_account_deletions();
  delete from public.sets where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n_sets = row_count;
  update public.votes set ip_hash = null where ip_hash is not null and created_at < now() - interval '30 days';
  get diagnostics n_votes_ip = row_count;
  update public.votes set device_hash = 'expired:' || id::text where device_hash not like 'expired:%' and created_at < now() - interval '90 days';
  get diagnostics n_votes_dev = row_count;
  insert into public.click_totals (item_id, day, network, clicks)
    select item_id, created_at::date, network, count(*) from public.clicks where created_at < now() - interval '90 days'
    group by item_id, created_at::date, network
  on conflict (item_id, day, network) do update set clicks = public.click_totals.clicks + excluded.clicks;
  delete from public.clicks where created_at < now() - interval '90 days';
  get diagnostics n_clicks = row_count;
  delete from public.notifications where read_at is not null and read_at < now() - interval '90 days';
  get diagnostics n_notes = row_count;
  update public.messages set body = ' ' where deleted_at is not null and deleted_at < now() - interval '30 days' and body <> ' ';
  get diagnostics n_msgs = row_count;
  update public.reports set evidence = null where evidence is not null and resolved_at is not null and resolved_at < now() - interval '2 years';
  get diagnostics n_ev = row_count;
  return jsonb_build_object('accounts', n_acc, 'sets', n_sets, 'votes_ip', n_votes_ip, 'votes_device', n_votes_dev, 'clicks', n_clicks,
                            'notifications', n_notes, 'messages', n_msgs, 'evidence', n_ev);
end $$;
