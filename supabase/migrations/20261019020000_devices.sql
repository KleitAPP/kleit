-- 105: "Where you're signed in" (spec 3.6 #6; CL66). `user_devices` has existed since 004 and
-- nothing ever wrote to it. Three functions make it real:
--
--   touch_device(label)   the app, once per start: the row for THIS session (the JWT's
--                         session_id) is made or its last_seen_at and label refreshed. Nothing
--                         else can write the table (004 revoked insert/update from the app).
--   my_devices()          the list, newest first, with `this_one` marking the caller's session;
--                         rows whose session Supabase has already ended (signed out, expired,
--                         Sign out everywhere) are dropped on the way so the list tells the truth.
--   sign_out_device(id)   ends ONE other session - the row's session is deleted from auth.sessions,
--                         so its refresh token dies and that device is signed out within the hour
--                         (an access token already issued lives out its hour; the same truth as
--                         Supabase's own global sign-out). Your own session is refused: Sign out
--                         is for that, and it also clears the phone (signOut.ts).
--
-- No city: it would need the caller's IP, which the database never sees, and a guess from the
-- Worker would be another thing to be wrong about. The label is the app's own reading of the
-- browser ("iPhone · Safari"), at most 80 characters, never anything a person typed.

create unique index if not exists user_devices_session_idx on public.user_devices (user_id, session_id);

create or replace function public.touch_device(p_label text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  label text := left(coalesce(p_label, ''), 80);
begin
  if me is null or sid is null then return; end if;
  insert into public.user_devices (user_id, session_id, device_label, last_seen_at)
  values (me, sid, label, now())
  on conflict (user_id, session_id) do update
    set last_seen_at = now(),
        device_label = case when excluded.device_label = '' then public.user_devices.device_label else excluded.device_label end;
end $$;
revoke all on function public.touch_device(text) from public;
grant execute on function public.touch_device(text) to authenticated;

create or replace function public.my_devices()
returns table (id uuid, device_label text, last_seen_at timestamptz, created_at timestamptz, this_one boolean)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if me is null then return; end if;
  -- A session Supabase has ended is not a place you are signed in.
  delete from public.user_devices d
  where d.user_id = me
    and d.session_id is not null
    and not exists (select 1 from auth.sessions s where s.id = d.session_id);
  return query
    select d.id, d.device_label, d.last_seen_at, d.created_at, d.session_id is not distinct from sid
    from public.user_devices d
    where d.user_id = me
    order by (d.session_id is not distinct from sid) desc, d.last_seen_at desc;
end $$;
revoke all on function public.my_devices() from public;
grant execute on function public.my_devices() to authenticated;

create or replace function public.sign_out_device(p_device uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  target uuid;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select d.session_id into target from public.user_devices d where d.id = p_device and d.user_id = me;
  if not found then raise exception 'not one of your devices' using errcode = '42501'; end if;
  if target is not distinct from sid then
    raise exception 'this is the device you are on: use Sign out' using errcode = 'P0001';
  end if;
  if target is not null then
    delete from auth.sessions s where s.id = target and s.user_id = me;
  end if;
  delete from public.user_devices d where d.id = p_device and d.user_id = me;
end $$;
revoke all on function public.sign_out_device(uuid) from public;
grant execute on function public.sign_out_device(uuid) to authenticated;
