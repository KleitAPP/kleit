-- 084 · "Poll results" (spec 12.1 #1): when a poll closes - by its clock or by the owner - the
-- owner is told once, in the app and (if they said yes) on the phone. A timer every ten minutes
-- catches the ones that closed by the clock; closing by hand is caught by the same trigger
-- path. Polls with no votes at all say nothing: there is nothing to read.
alter table public.polls add column results_told_at timestamptz;

alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided', 'remix', 'mention', 'tag',
                  'poll_results'));

create or replace function private.tell_poll_results()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in
    select p.id, p.owner_id from public.polls p
     where p.results_told_at is null and p.deleted_at is null and p.takedown_state = 'none'
       and (p.closed_at is not null or p.closes_at <= now())
       and exists (select 1 from public.votes v where v.poll_id = p.id)
     limit 200
  loop
    perform private.notify(r.owner_id, 'poll_results', null, 'poll', r.id, false);
    update public.polls set results_told_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.tell_poll_results() from public, anon, authenticated;
select cron.unschedule('poll-results') where exists (select 1 from cron.job where jobname = 'poll-results');
select cron.schedule('poll-results', '*/10 * * * *', $$select private.tell_poll_results()$$);
