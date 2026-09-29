-- Migration 014 — the scan sweeper: no photo is ever left unscanned for ever (open problem CL25;
-- spec 13.1; roadmap M2.5/M2.6).
--
-- The gap it closes. When a photo is added the app asks `ingest-image` to screen it and waits.
-- Proven live on 2026-09-28: a cold start plus a full decode plus an AWS round trip outlasted the
-- wait, the screen truthfully said "still checking", and then nothing ever checked - the item sat
-- unscanned (invisible, the safe direction) until somebody called the function again by hand.
--
-- The shape of the fix. The database keeps the list of what still needs a scan, hands it out in
-- claimed batches, and every couple of minutes asks the `sweep-images` function to work through
-- one. Three pieces:
--
--   1. `item_flags.attempts` - how many times a scan has been started for this item. The sweeper
--      gives up after a few, so a photo that crashes the scanner every time is tried five times
--      and then left pending, where the count is how a person finds it.
--   2. `claim_scans(limit)` - ONE statement that picks the stragglers and marks them claimed, so
--      two sweeps that overlap cannot both scan the same photo. Server only.
--   3. `private.sweep_scans()` on a pg_cron timer, which posts to the function through pg_net.
--      The function's address and its secret come from the vault, put there by CI on every deploy
--      and never written in a migration. If the vault has no entry the timer does nothing, loudly.
--
-- What this migration cannot do: mark anything clean. Only the function does that, and only from
-- a real AWS answer. The read policy from migration 010 is unchanged.

-- ---------------------------------------------------------------------------
-- 1. The attempt count
-- ---------------------------------------------------------------------------
alter table public.item_flags
  add column attempts integer not null default 0
  check (attempts >= 0);

-- The app's own call counts itself before it starts, so a scan that dies half-way through still
-- used one of the item's tries. Server only: the app must not be able to spend an item's tries.
create or replace function public.count_scan_attempt(p_item_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.item_flags as f (item_id, scan_state, attempts)
  values (p_item_id, 'pending', 1)
  on conflict (item_id) do update
    set attempts = f.attempts + 1;
$$;
revoke all on function public.count_scan_attempt(uuid) from public, anon, authenticated;
grant execute on function public.count_scan_attempt(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Claiming a batch
-- ---------------------------------------------------------------------------
-- An item needs the sweeper when: it has a picture; it is not deleted or taken down; it is at
-- least 90 seconds old, so the app's own call has had its chance; it has no verdict yet; it has
-- not already been tried five times; and nothing has claimed it in the last three minutes, which
-- is longer than a scan can take. Oldest first, so nobody waits for ever behind a flood.
create or replace function public.claim_scans(p_limit integer default 10)
returns table (id uuid, image_id text, image_bucket text)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select i.id, i.image_id, i.image_bucket::text
    from public.items i
    left join public.item_flags f on f.item_id = i.id
    where i.image_id is not null
      and i.deleted_at is null
      and i.takedown_state = 'none'
      and i.created_at < now() - interval '90 seconds'
      and (f.item_id is null or f.scan_state = 'pending')
      and coalesce(f.attempts, 0) < 5
      and (f.updated_at is null or f.updated_at < now() - interval '3 minutes')
    order by i.created_at
    limit greatest(least(coalesce(p_limit, 10), 50), 1)
    for update of i skip locked
  ),
  claimed as (
    insert into public.item_flags as f (item_id, scan_state, attempts)
    select due.id, 'pending', 1 from due
    on conflict (item_id) do update
      set attempts = f.attempts + 1,
          updated_at = now()
    returning item_id
  )
  select due.id, due.image_id, due.image_bucket
  from due
  join claimed on claimed.item_id = due.id;
$$;
revoke all on function public.claim_scans(integer) from public, anon, authenticated;
grant execute on function public.claim_scans(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The timer
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Posts to the sweeper. The address and the secret are read from the vault at call time, so
-- rotating either is a vault write and nothing here changes. With no vault entry it does nothing
-- and says so in the log, because a sweeper that silently does nothing is the bug this migration
-- exists to fix.
create or replace function private.sweep_scans()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sweep_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sweep_secret' limit 1;
  if v_url is null or v_secret is null then
    raise warning 'sweep_scans: sweep_url or sweep_secret is not in the vault; nothing swept';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sweep-key', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke all on function private.sweep_scans() from public, anon, authenticated;

-- Every two minutes. Re-running this migration on a fresh database must not leave two timers.
select cron.unschedule('sweep-images')
where exists (select 1 from cron.job where jobname = 'sweep-images');
select cron.schedule('sweep-images', '*/2 * * * *', $$select private.sweep_scans()$$);
