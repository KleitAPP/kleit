-- 049 · The nightly cleanup (roadmap M7.6; spec 14.2–14.3): the retention periods the data map
-- promises, enforced by one job every night at 09:00 UTC (4 am in the East). Each period is a
-- line here, so the privacy policy and the job can be read side by side. What it does:
--   · Recently deleted sets: gone for good 30 days after deletion (their versions and rows go
--     with them by cascade). The owner had thirty days to restore.
--   · Votes: the raw network hash is dropped after 30 days; the device hash after 90 (the vote
--     itself and its weight stay, so totals never change).
--   · Buy-link clicks: raw rows after 90 days become one count per item per day, then go.
--   · Notifications read more than 90 days ago go.
--   · Taken-back messages: the words are blanked 30 days after being taken back.
--   · Moderation evidence (the DM lines carried by a report): dropped 2 years after resolution.
-- Items (and their stored pictures) are not here: the file in the bucket has to go with the
-- row, which is the sweeper function's job, not SQL's (CL42).

create table public.click_totals (
  item_id uuid not null,
  day date not null,
  network text not null,
  clicks integer not null,
  primary key (item_id, day, network)
);
alter table public.click_totals enable row level security;
revoke all on table public.click_totals from anon, authenticated;

-- The messages guard refuses any change but taking back; the cleanup is the one exception.
create or replace function private.messages_guard()
returns trigger language plpgsql as $$
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.body <> old.body or new.sender_id <> old.sender_id or new.conversation_id <> old.conversation_id
     or new.created_at <> old.created_at or (old.deleted_at is not null and new.deleted_at is null) then
    raise exception 'only taking a message back is allowed' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.nightly_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_sets int; n_votes_ip int; n_votes_dev int; n_clicks int; n_notes int; n_msgs int; n_ev int;
begin
  perform set_config('kleit.server_write', '1', true);
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
  return jsonb_build_object('sets', n_sets, 'votes_ip', n_votes_ip, 'votes_device', n_votes_dev, 'clicks', n_clicks,
                            'notifications', n_notes, 'messages', n_msgs, 'evidence', n_ev);
end $$;
revoke all on function private.nightly_cleanup() from public;

select cron.unschedule('nightly-cleanup') where exists (select 1 from cron.job where jobname = 'nightly-cleanup');
select cron.schedule('nightly-cleanup', '0 9 * * *', $$select private.nightly_cleanup()$$);
