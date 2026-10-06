-- 038 · Contests (roadmap M6.4; spec 11 #3–#4): a weekly challenge opens, takes entries, and
-- closes on time. Badges and features only - no prizes, no money (spec 11 #3). Kleit's staff
-- open a contest (admins only; the Monday theme); anyone signed in enters one of their own
-- public published sets while it is open, once per contest, and may withdraw it. The ranking is
-- the week's likes on each entry's set, read live; nobody edits a rank.

create table public.contests (
  id uuid primary key default gen_random_uuid(),
  title text not null constraint contests_title_length check (char_length(title) between 3 and 80),
  theme text not null default '' constraint contests_theme_length check (char_length(theme) <= 500),
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint contests_closes_after_opens check (closes_at > opens_at)
);
alter table public.contests enable row level security;
revoke all on table public.contests from anon;
revoke delete, truncate on table public.contests from authenticated;
create index contests_closes_idx on public.contests (closes_at desc);

create table public.contest_entries (
  contest_id uuid not null references public.contests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  set_id uuid not null references public.sets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contest_id, user_id),
  unique (contest_id, set_id)
);
alter table public.contest_entries enable row level security;
revoke all on table public.contest_entries from anon;
revoke update, truncate on table public.contest_entries from authenticated;
create index contest_entries_set_idx on public.contest_entries (set_id);

-- Contests: everyone signed in reads; admins open and change them.
create policy "contests: signed-in read" on public.contests for select to authenticated using (true);
create policy "contests: admins open" on public.contests for insert to authenticated
  with check ((select private.is_admin()) and created_by = (select auth.uid()));
create policy "contests: admins change" on public.contests for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Entries: readable when the entry's set is visible to the reader and not across a block;
-- entered by its owner with their own public published set while the contest is open;
-- withdrawn by its owner at any time (a withdrawn entry simply goes).
create policy "contest_entries: readers of the set read" on public.contest_entries for select to authenticated
  using (
    (select public.can_view_set(set_id, (select auth.uid())))
    and not (select private.blocked_either_way((select auth.uid()), user_id))
  );
create policy "contest_entries: enter with your own public set while open" on public.contest_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.sets s where s.id = set_id and s.owner_id = user_id and s.status = 'published' and s.visibility = 'public' and s.deleted_at is null)
    and exists (select 1 from public.contests c where c.id = contest_id and now() >= c.opens_at and now() < c.closes_at)
  );
create policy "contest_entries: owner withdraws" on public.contest_entries for delete to authenticated
  using (user_id = (select auth.uid()));

-- The board: every entry the caller may see, ranked by likes on the set since the contest
-- opened (security invoker, so the caller's own read policies apply throughout).
create or replace function public.contest_board(p_contest uuid)
returns table (set_id uuid, user_id uuid, username text, title text, preview_image_id text, likes bigint, entered_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select e.set_id, e.user_id, p.username, s.title, s.preview_image_id,
         (select count(*) from public.likes l where l.set_id = e.set_id and l.created_at >= c.opens_at) as likes,
         e.created_at
    from public.contest_entries e
    join public.contests c on c.id = e.contest_id
    join public.sets s on s.id = e.set_id
    join public.profiles p on p.user_id = e.user_id
   where e.contest_id = p_contest
   order by likes desc, e.created_at asc
   limit 200;
$$;
revoke all on function public.contest_board(uuid) from public;
grant execute on function public.contest_board(uuid) to authenticated;

-- The first weekly challenge, so the screen is not empty on day one. Opens now, closes in a week.
insert into public.contests (title, theme, closes_at)
values ('Week 1 · Autumn layers', 'Build a set around one great layer - a coat, a cardigan, a scarf. Enter one public set.', now() + interval '7 days');
