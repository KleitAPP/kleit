-- 064 · The quiet side of moderation is told (spec 13.4: "what happens after I report?"). Three
-- in-app notifications, written by triggers like every other (031): the reporter hears that
-- their report was reviewed (never the outcome in detail - that is under Settings > Your
-- reports); a struck person hears about the strike; an appellant hears the decision. No actor
-- on any of them: moderators are never named to members. The word list's own reports (the
-- author is the "reporter" of their own held comment) tell nobody.

alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided'));
alter table public.notifications drop constraint notifications_ref_type;
alter table public.notifications add constraint notifications_ref_type
  check (ref_type in ('set', 'poll', 'conversation', 'profile', 'group', 'ask', 'contest', 'report', 'strike'));

create or replace function private.notify_report_resolved() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state in ('actioned', 'dismissed') and old.state not in ('actioned', 'dismissed')
     and new.reporter_id is not null and new.reporter_id is distinct from new.target_owner_id then
    perform private.notify(new.reporter_id, 'report_resolved', null, 'report', new.id);
  end if;
  return new;
end $$;
create trigger reports_notify_resolved after update on public.reports
  for each row execute function private.notify_report_resolved();

create or replace function private.notify_strike() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.user_id, 'strike', null, 'strike', new.id);
  return new;
end $$;
create trigger strikes_notify after insert on public.strikes
  for each row execute function private.notify_strike();

create or replace function private.notify_appeal_decided() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state in ('upheld', 'overturned') and old.state = 'open' then
    perform private.notify(new.user_id, 'appeal_decided', null, 'strike', new.strike_id);
  end if;
  return new;
end $$;
create trigger appeals_notify_decided after update on public.appeals
  for each row execute function private.notify_appeal_decided();
