-- 076 · When an account deletion is made final, the services that still hold the person's id
-- must forget them too (spec 3.7 #10; CL53). Today that is OneSignal (push, M8.4a): it keeps
-- the phone's push subscription under our user id (`external_id`), and nothing else - no email,
-- no name. SQL cannot call it, so finalization leaves a row here and the send-push function,
-- which pg_cron already visits every minute, drains the rows with the REST key.
--
-- Server only: RLS on, no policy (the audit's server-only list). `user_id` has no reference
-- because the account is gone by the time the row is read; it is the only thing the row says.
create table public.external_cleanups (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  service text not null check (service in ('onesignal')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
comment on table public.external_cleanups is 'Accounts made final whose id an outside service must still forget (CL53). Server only.';
alter table public.external_cleanups enable row level security;
revoke all on table public.external_cleanups from anon, authenticated;
create index external_cleanups_due_idx on public.external_cleanups (created_at) where done_at is null;

-- The nightly finalization (051, 065) leaves the row just before the account goes.
create or replace function private.finalize_account_deletions()
returns integer language plpgsql security definer set search_path = '' as $$
declare d record; n integer := 0;
begin
  perform set_config('kleit.server_write', '1', true);
  for d in select user_id from public.account_deletions where state = 'pending' and final_at <= now() loop
    -- Remixes of their sets stay, credited to a deleted account (spec 3.7 #8).
    update public.sets set remixed_from_set_id = null, remixed_from_label = 'Remixed from a deleted account'
     where remixed_from_set_id in (select id from public.sets where owner_id = d.user_id);
    -- Their own photos go tonight with no evidence copy (claim_purges: deleted 30 days ago, not taken down);
    -- clipped store pieces stay with no owner (the FK sets null on cascade).
    update public.items set deleted_at = now() - interval '31 days' where owner_id = d.user_id and kind = 'own' and takedown_state = 'none';
    -- Their messages read "unavailable" (the FK sets the sender null; mark them too).
    update public.messages set deleted_at = coalesce(deleted_at, now()) where sender_id = d.user_id;
    -- The 18+ record forgets when to purge: 30 more days (spec 3.7 #4).
    update public.age_confirmations set purge_after = now() + interval '30 days' where user_id_hash = encode(sha256(d.user_id::text::bytea), 'hex') and purge_after is null;
    -- The outside services that know the id (spec 3.7 #10): a row per service, drained by send-push.
    insert into public.external_cleanups (user_id, service) values (d.user_id, 'onesignal');
    update public.account_deletions set state = 'completed' where user_id = d.user_id;
    delete from auth.users where id = d.user_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- A batch for the function: oldest first, ten tries, claimed rows skipped by a second runner.
create or replace function public.claim_cleanups(p_limit integer default 20)
returns table (id bigint, user_id uuid, service text)
language sql security definer set search_path = '' as $$
  with picked as (
    select x.id from public.external_cleanups x
     where x.done_at is null and x.attempts < 10
     order by x.created_at limit greatest(1, least(p_limit, 200))
     for update skip locked
  ), claimed as (
    update public.external_cleanups c set attempts = c.attempts + 1
      from picked where c.id = picked.id
    returning c.id, c.user_id, c.service
  )
  select c.id, c.user_id, c.service from claimed c;
$$;
revoke all on function public.claim_cleanups(integer) from public, anon, authenticated;
grant execute on function public.claim_cleanups(integer) to service_role;

create or replace function public.mark_cleanup(p_id bigint)
returns void language sql security definer set search_path = '' as $$
  update public.external_cleanups set done_at = now() where id = p_id and done_at is null;
$$;
revoke all on function public.mark_cleanup(bigint) from public, anon, authenticated;
grant execute on function public.mark_cleanup(bigint) to service_role;

-- Done rows are forgotten after 30 days, with the push queue's own nightly tidy.
create or replace function private.cleanup_push_queue() returns integer language sql security definer set search_path = '' as $$
  with gone as (delete from public.push_queue where state in ('sent', 'dropped', 'failed') and created_at < now() - interval '30 days' returning 1),
       forgot as (delete from public.external_cleanups where done_at is not null and done_at < now() - interval '30 days' returning 1)
  select (select count(*)::int from gone) + (select count(*)::int from forgot);
$$;
