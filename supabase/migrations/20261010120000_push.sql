-- Migration 073 — push notifications, the server half (roadmap M8.4a; spec 10.3; CL36).
-- Everything here sits behind one switch, app_settings.push_open (false until the owner turns it
-- on from /mod/switches): while it is off the sender does nothing and the app never asks the
-- phone for permission. The in-app notification rows (031) stay the source of truth; this only
-- decides which of them also reach a phone, and when.

-- 1. The switch. (The known-key constraint is rewritten whole, as 002 wrote it.)
alter table public.app_settings drop constraint app_settings_known_key;
alter table public.app_settings add constraint app_settings_known_key check (key in (
  'min_app_version', 'maintenance_mode', 'signups_open', 'posting_open',
  'dms_open', 'comments_open', 'public_links_open', 'push_open'));
insert into public.app_settings (key, value) values ('push_open', 'false') on conflict (key) do nothing;

-- 2. One row per person: whether they said yes on their phone, and their time zone for the quiet
--    hours. Written by the app after the phone's own prompt; never by anyone else.
create table public.push_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'UTC',
  platform text constraint push_settings_platform check (platform in ('android', 'ios', 'web')),
  updated_at timestamptz not null default now()
);
alter table public.push_settings enable row level security;
revoke all on table public.push_settings from anon;
revoke truncate on table public.push_settings from authenticated;
create policy "push_settings: own read" on public.push_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy "push_settings: own insert" on public.push_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "push_settings: own update" on public.push_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "push_settings: own delete" on public.push_settings for delete to authenticated
  using (user_id = (select auth.uid()));
create trigger push_settings_touch before update on public.push_settings
  for each row execute function private.touch_updated_at();

-- A time zone the database does not know becomes UTC rather than an error at send time.
create or replace function private.push_settings_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.timezone is null or length(new.timezone) > 64
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    new.timezone := 'UTC';
  end if;
  return new;
end $$;
create trigger push_settings_guard before insert or update on public.push_settings
  for each row execute function private.push_settings_guard();

-- 3. The outbox. Server only: no policy, no grant to anon or authenticated.
create table public.push_queue (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  notification_id uuid references public.notifications (id) on delete cascade,
  kind text not null,
  ref_type text,
  ref_id uuid,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  state text not null default 'pending' constraint push_queue_state check (state in ('pending', 'claimed', 'sent', 'failed', 'dropped')),
  attempts integer not null default 0,
  sent_at timestamptz
);
alter table public.push_queue enable row level security;
revoke all on table public.push_queue from anon, authenticated;
create index push_queue_due_idx on public.push_queue (state, due_at) where state in ('pending', 'claimed');
create index push_queue_user_idx on public.push_queue (user_id, notification_id);

-- 4. Quiet hours (spec 10.3): nothing between 10 pm and 8 am in the viewer's own zone. A push
--    that would land then waits for 8 am. Everything else goes at once.
create or replace function private.push_due_at(p_user uuid, p_at timestamptz default now())
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare tz text; local_at timestamp;
begin
  select s.timezone into tz from public.push_settings s where s.user_id = p_user;
  tz := coalesce(tz, 'UTC');
  local_at := p_at at time zone tz;
  if local_at::time >= time '22:00' then
    return ((local_at::date + 1) + time '08:00') at time zone tz;
  elsif local_at::time < time '08:00' then
    return (local_at::date + time '08:00') at time zone tz;
  end if;
  return p_at;
end $$;
revoke all on function private.push_due_at(uuid, timestamptz) from public, anon, authenticated;

-- 5. Which notification rows become pushes. A new row: one push. A bundled row (a like or a vote
--    updated within the hour, 031/040): not another push while one is already waiting, and not
--    more than one an hour for the same row - "twelve likes in an hour arrive as one". Nobody
--    hidden (banned, on a break, deleting) and nobody who has not said yes on their phone.
create or replace function private.push_enqueue() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select s.value::text from public.app_settings s where s.key = 'push_open'), 'false') <> 'true' then return new; end if;
  if not exists (select 1 from public.push_settings s where s.user_id = new.user_id and s.enabled) then return new; end if;
  if (select private.is_hidden_account(new.user_id)) then return new; end if;
  if new.read_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.bundled_count <= old.bundled_count then return new; end if;
    if exists (select 1 from public.push_queue q where q.notification_id = new.id and q.state in ('pending', 'claimed')) then return new; end if;
    if exists (select 1 from public.push_queue q where q.notification_id = new.id and q.state = 'sent' and q.sent_at > now() - interval '1 hour') then return new; end if;
  end if;
  insert into public.push_queue (user_id, notification_id, kind, ref_type, ref_id, due_at)
  values (new.user_id, new.id, new.kind, new.ref_type, new.ref_id, private.push_due_at(new.user_id));
  return new;
end $$;
create trigger notifications_push after insert or update of bundled_count on public.notifications
  for each row execute function private.push_enqueue();

-- 6. The sender's two doors (service role only, like claim_text_checks).
create or replace function public.claim_pushes(p_limit integer default 100)
returns table (id bigint, user_id uuid, kind text, ref_type text, ref_id uuid, bundled_count integer, actor_username text, due_at timestamptz)
language sql security definer set search_path = '' as $$
  with picked as (
    select q.id from public.push_queue q
     where q.state = 'pending' and q.due_at <= now() and q.attempts < 3
     order by q.due_at limit greatest(1, least(p_limit, 500))
     for update skip locked
  ), claimed as (
    update public.push_queue q set state = 'claimed', attempts = q.attempts + 1
      from picked where q.id = picked.id
    returning q.id, q.user_id, q.kind, q.ref_type, q.ref_id, q.notification_id, q.due_at
  )
  select c.id, c.user_id, c.kind, c.ref_type, c.ref_id,
         coalesce((select n.bundled_count from public.notifications n where n.id = c.notification_id), 1),
         (select p.username from public.profiles p where p.user_id = (select n.actor_id from public.notifications n where n.id = c.notification_id)),
         c.due_at
    from claimed c;
$$;
revoke all on function public.claim_pushes(integer) from public, anon, authenticated;
grant execute on function public.claim_pushes(integer) to service_role;

-- 'sent' and 'dropped' are final; 'failed' goes back to pending for another try (three in all).
create or replace function public.mark_pushes(p_ids bigint[], p_state text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('sent', 'failed', 'dropped') then raise exception 'unknown state' using errcode = '22023'; end if;
  update public.push_queue q
     set state = case when p_state = 'failed' and q.attempts < 3 then 'pending' else p_state end,
         sent_at = case when p_state = 'sent' then now() else q.sent_at end
   where q.id = any (p_ids) and q.state = 'claimed';
end $$;
revoke all on function public.mark_pushes(bigint[], text) from public, anon, authenticated;
grant execute on function public.mark_pushes(bigint[], text) to service_role;

-- 7. The timer: every minute, only when something is due, with the sweeper's secret and address.
create or replace function private.send_pushes()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if coalesce((select s.value::text from public.app_settings s where s.key = 'push_open'), 'false') <> 'true' then return; end if;
  if not exists (select 1 from public.push_queue q where q.state = 'pending' and q.due_at <= now() and q.attempts < 3) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sweep_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sweep_secret' limit 1;
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := replace(v_url, '/sweep-images', '/send-push'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sweep-key', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function private.send_pushes() from public, anon, authenticated;
select cron.unschedule('send-push') where exists (select 1 from cron.job where jobname = 'send-push');
select cron.schedule('send-push', '* * * * *', $$select private.send_pushes()$$);

-- A claimed row whose sender died keeps nobody waiting for ever: back to pending after ten minutes.
create or replace function private.unstick_pushes() returns integer language sql security definer set search_path = '' as $$
  with back as (
    update public.push_queue set state = 'pending' where state = 'claimed' and created_at < now() - interval '10 minutes' and attempts < 3 returning 1
  ) select count(*)::int from back;
$$;
revoke all on function private.unstick_pushes() from public, anon, authenticated;
select cron.unschedule('unstick-pushes') where exists (select 1 from cron.job where jobname = 'unstick-pushes');
select cron.schedule('unstick-pushes', '*/10 * * * *', $$select private.unstick_pushes()$$);

-- The nightly cleanup forgets finished rows after 30 days.
create or replace function private.cleanup_push_queue() returns integer language sql security definer set search_path = '' as $$
  with gone as (delete from public.push_queue where state in ('sent', 'dropped', 'failed') and created_at < now() - interval '30 days' returning 1) select count(*)::int from gone;
$$;
revoke all on function private.cleanup_push_queue() from public, anon, authenticated;
select cron.unschedule('cleanup-push-queue') where exists (select 1 from cron.job where jobname = 'cleanup-push-queue');
select cron.schedule('cleanup-push-queue', '25 9 * * *', $$select private.cleanup_push_queue()$$);
