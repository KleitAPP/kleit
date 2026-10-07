-- 043 · The weekly rhythm (roadmap M6.2; spec 11 #4; CL39): the Monday theme opens itself and
-- the Friday result is announced. A queue of themes (admins fill it; a few are seeded), a
-- pg_cron job every Monday morning that opens the next one when nothing is open, and a daily
-- job that tells every entrant when their challenge has closed, with a link to the results.

create table public.contest_themes (
  id uuid primary key default gen_random_uuid(),
  title text not null constraint contest_themes_title_length check (char_length(title) between 3 and 80),
  theme text not null default '' constraint contest_themes_theme_length check (char_length(theme) <= 500),
  position integer not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.contest_themes enable row level security;
revoke all on table public.contest_themes from anon;
revoke delete, truncate on table public.contest_themes from authenticated;
create policy "contest_themes: admins read" on public.contest_themes for select to authenticated using ((select private.is_admin()));
create policy "contest_themes: admins queue" on public.contest_themes for insert to authenticated with check ((select private.is_admin()));
create policy "contest_themes: admins change" on public.contest_themes for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.contests add column announced_at timestamptz;

insert into public.contest_themes (title, theme, position) values
  ('Week 2 · One colour', 'Head to toe in one colour family. Texture does the talking.', 2),
  ('Week 3 · Thrifted first', 'Build around one second-hand or vintage piece.', 3),
  ('Week 4 · Rainy day', 'Something you would actually wear in the rain and still like.', 4),
  ('Week 5 · Borrowed from the boys', 'Menswear shapes, your way.', 5),
  ('Week 6 · Under $100', 'The whole set, every piece priced, under a hundred dollars.', 6);

-- Opens the next theme when nothing is open. Idempotent: run it twice, it does nothing twice.
create or replace function private.open_weekly_contest()
returns uuid language plpgsql security definer set search_path = '' as $$
declare th public.contest_themes%rowtype; cid uuid;
begin
  if exists (select 1 from public.contests c where now() >= c.opens_at and now() < c.closes_at) then
    return null;
  end if;
  select * into th from public.contest_themes t where t.used_at is null order by t.position limit 1;
  if th.id is null then return null; end if;
  insert into public.contests (title, theme, opens_at, closes_at)
  values (th.title, th.theme, now(), now() + interval '7 days') returning id into cid;
  update public.contest_themes set used_at = now() where id = th.id;
  return cid;
end $$;
revoke all on function private.open_weekly_contest() from public;

-- Tells every entrant once when a contest has closed; points them at the results.
create or replace function private.announce_closed_contests()
returns integer language plpgsql security definer set search_path = '' as $$
declare c record; n integer := 0;
begin
  for c in select id from public.contests where closes_at <= now() and announced_at is null loop
    insert into public.notifications (user_id, kind, actor_id, ref_type, ref_id)
    select e.user_id, 'contest_results', null, 'contest', c.id from public.contest_entries e where e.contest_id = c.id;
    update public.contests set announced_at = now() where id = c.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.announce_closed_contests() from public;

alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite', 'ask_answer', 'ask_chosen', 'contest_results'));
alter table public.notifications drop constraint notifications_ref_type;
alter table public.notifications add constraint notifications_ref_type
  check (ref_type in ('set', 'poll', 'conversation', 'profile', 'group', 'ask', 'contest'));

-- Monday 9:00 in the East (13:00 UTC), and results every day at 9:05 so a Friday close is told on Friday.
select cron.unschedule('open-weekly-contest') where exists (select 1 from cron.job where jobname = 'open-weekly-contest');
select cron.schedule('open-weekly-contest', '0 13 * * 1', $$select private.open_weekly_contest()$$);
select cron.unschedule('announce-closed-contests') where exists (select 1 from cron.job where jobname = 'announce-closed-contests');
select cron.schedule('announce-closed-contests', '5 13 * * *', $$select private.announce_closed_contests()$$);
