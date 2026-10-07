-- 044 · Reports (roadmap M7.1; spec 13.3, 13.4; technical pack rows 46–47 in part). A Report
-- button on every set, piece, comment, profile, conversation and group, through ONE door,
-- `file_report()`, which hands back a reference number. Reports are read by their reporter (by
-- reference, state only) and by moderators; nobody else. A report of a conversation carries the
-- last ten messages as evidence for the moderator (spec 10.2 #8) - the reporter is told so on
-- the sheet. Twenty reports a day per person; the same thing twice is one report.

create or replace function private.is_moderator()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role in ('admin', 'moderator'));
$$;
revoke all on function private.is_moderator() from public;
grant execute on function private.is_moderator() to authenticated;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  request_ref text not null unique,
  reporter_id uuid references auth.users (id) on delete set null,
  target_type text not null constraint reports_target_type check (target_type in ('set', 'item', 'comment', 'profile', 'conversation', 'group')),
  target_id uuid not null,
  target_owner_id uuid references auth.users (id) on delete set null,
  reason text not null constraint reports_reason check (reason in ('nudity', 'harassment', 'hate', 'self_harm', 'spam', 'impersonation', 'underage', 'counterfeit', 'copyright', 'this_is_me', 'intimate_image', 'other')),
  note text not null default '' constraint reports_note_length check (char_length(note) <= 500),
  evidence jsonb,
  state text not null default 'open' constraint reports_state check (state in ('open', 'reviewing', 'actioned', 'dismissed')),
  priority text not null default 'normal' constraint reports_priority check (priority in ('urgent', 'normal')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  resolution_note text not null default '' constraint reports_resolution_length check (char_length(resolution_note) <= 500)
);
alter table public.reports enable row level security;
revoke all on table public.reports from anon;
revoke insert, delete, truncate on table public.reports from authenticated;
create index reports_queue_idx on public.reports (priority, created_at) where state in ('open', 'reviewing');
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
create index reports_target_idx on public.reports (target_type, target_id);

-- The reporter sees their own reports' state, never the evidence (a view below strips it);
-- moderators read everything. Only moderators change a report, and only its state and notes.
create policy "reports: moderators read" on public.reports for select to authenticated
  using ((select private.is_moderator()));
create policy "reports: moderators resolve" on public.reports for update to authenticated
  using ((select private.is_moderator())) with check ((select private.is_moderator()));
create or replace function private.reports_guard()
returns trigger language plpgsql as $$
begin
  if new.reporter_id is distinct from old.reporter_id or new.target_type <> old.target_type or new.target_id <> old.target_id
     or new.reason <> old.reason or new.note <> old.note or new.evidence is distinct from old.evidence
     or new.request_ref <> old.request_ref or new.created_at <> old.created_at then
    raise exception 'a report is only ever resolved, never rewritten' using errcode = '42501';
  end if;
  if new.state in ('actioned', 'dismissed') and old.state not in ('actioned', 'dismissed') then
    new.resolved_at := now();
    new.resolved_by := auth.uid();
  end if;
  return new;
end $$;
create trigger reports_guard before update on public.reports for each row execute function private.reports_guard();

-- The one door. Runs as the server so it can look at what is being reported (a set the
-- reporter can see, a conversation they are in, a profile that exists) and write the row.
create or replace function public.file_report(p_type text, p_id uuid, p_reason text, p_note text default '')
returns text language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  owner uuid;
  ev jsonb;
  ref text;
  existing text;
begin
  if me is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if (select count(*) from public.reports r where r.reporter_id = me and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too_many' using errcode = 'P0003';
  end if;
  -- What is it, whose is it, and may this person see it at all?
  if p_type = 'set' then
    select s.owner_id into owner from public.sets s where s.id = p_id and (select public.can_view_set(s.id, me));
  elsif p_type = 'item' then
    select i.owner_id into owner from public.items i where i.id = p_id;
  elsif p_type = 'comment' then
    select c.author_id into owner from public.comments c where c.id = p_id and (select public.can_view_set(c.set_id, me));
  elsif p_type = 'profile' then
    select p.user_id into owner from public.profiles p where p.user_id = p_id;
  elsif p_type = 'conversation' then
    select case when c.user_a = me then c.user_b else c.user_a end into owner
      from public.conversations c where c.id = p_id and me in (c.user_a, c.user_b);
    if owner is not null then
      select jsonb_agg(jsonb_build_object('sender', m.sender_id, 'body', m.body, 'at', m.created_at) order by m.created_at)
        into ev
        from (select * from public.messages m where m.conversation_id = p_id and m.deleted_at is null order by m.created_at desc limit 10) m;
    end if;
  elsif p_type = 'group' then
    select g.creator_id into owner from public.groups g where g.id = p_id;
  else
    raise exception 'unknown target' using errcode = '22023';
  end if;
  if owner is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if owner = me then raise exception 'own' using errcode = 'P0001'; end if;
  -- The same person reporting the same thing twice gets the same reference back.
  select r.request_ref into existing from public.reports r
   where r.reporter_id = me and r.target_type = p_type and r.target_id = p_id and r.state in ('open', 'reviewing');
  if existing is not null then return existing; end if;
  ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
  insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, evidence, priority)
  values (ref, me, p_type, p_id, owner, p_reason, coalesce(btrim(p_note), ''), ev,
          case when p_reason in ('underage', 'intimate_image', 'self_harm') then 'urgent' else 'normal' end);
  return ref;
end $$;
revoke all on function public.file_report(text, uuid, text, text) from public;
grant execute on function public.file_report(text, uuid, text, text) to authenticated;

-- Your own reports: reference, what, reason, where it got to. No evidence, no moderator notes.
create or replace function public.my_reports()
returns table (request_ref text, target_type text, reason text, state text, created_at timestamptz, resolved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.request_ref, r.target_type, r.reason, r.state, r.created_at, r.resolved_at
    from public.reports r where r.reporter_id = (select auth.uid())
   order by r.created_at desc limit 100;
$$;
revoke all on function public.my_reports() from public;
grant execute on function public.my_reports() to authenticated;
