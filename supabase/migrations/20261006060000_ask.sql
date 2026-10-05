-- 033 · Ask (roadmap M5.3, second half; spec 11 #7; technical pack §1.6 rows 35–36):
-- post a style question; others answer with a set; the asker picks a favourite.

create table public.ask_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  question text not null constraint ask_posts_question_length check (char_length(question) between 3 and 200),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  deleted_at timestamptz
);
alter table public.ask_posts enable row level security;
revoke all on table public.ask_posts from anon;
revoke delete, truncate on table public.ask_posts from authenticated;
create index ask_posts_open_idx on public.ask_posts (created_at desc) where closed_at is null and deleted_at is null;

create table public.ask_answers (
  id uuid primary key default gen_random_uuid(),
  ask_id uuid not null references public.ask_posts (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  set_id uuid not null references public.sets (id) on delete cascade,
  body text not null default '' constraint ask_answers_body_length check (char_length(body) <= 300),
  chosen boolean not null default false,
  created_at timestamptz not null default now(),
  unique (ask_id, author_id, set_id)
);
alter table public.ask_answers enable row level security;
revoke all on table public.ask_answers from anon;
revoke truncate on table public.ask_answers from authenticated;
create index ask_answers_ask_idx on public.ask_answers (ask_id, created_at);

create or replace function private.ask_author(p_ask uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select a.author_id from public.ask_posts a where a.id = p_ask;
$$;
revoke all on function private.ask_author(uuid) from public;
grant execute on function private.ask_author(uuid) to authenticated;

-- Questions: anyone signed in reads (not across a block with the asker); the asker writes and closes.
create policy "ask_posts: signed-in read" on public.ask_posts for select to authenticated
  using (deleted_at is null and not (select private.blocked_either_way((select auth.uid()), author_id)));
create policy "ask_posts: author asks" on public.ask_posts for insert to authenticated
  with check (author_id = (select auth.uid()));
create policy "ask_posts: author closes" on public.ask_posts for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create or replace function private.ask_posts_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (new.author_id <> old.author_id or new.question <> old.question or new.created_at <> old.created_at) then
    raise exception 'only closing or removing a question is allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ask_posts_guard before update on public.ask_posts for each row execute function private.ask_posts_guard();

-- Answers: readable when the answer's set is visible to the reader (a set the reader cannot see
-- is not an answer to them); written by its author with their own public, published set while
-- the question is open; the asker marks one chosen; the answerer takes their own back.
create policy "ask_answers: readers of the set read" on public.ask_answers for select to authenticated
  using (
    (select public.can_view_set(set_id, (select auth.uid())))
    and not (select private.blocked_either_way((select auth.uid()), author_id))
  );
create policy "ask_answers: answer with your own public set" on public.ask_answers for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and chosen = false
    and exists (select 1 from public.sets s where s.id = set_id and s.owner_id = author_id and s.status = 'published' and s.visibility = 'public' and s.deleted_at is null)
    and exists (select 1 from public.ask_posts a where a.id = ask_id and a.closed_at is null and a.deleted_at is null)
    and not (select private.blocked_either_way((select private.ask_author(ask_id)), author_id))
  );
create policy "ask_answers: the asker chooses" on public.ask_answers for update to authenticated
  using ((select private.ask_author(ask_id)) = (select auth.uid()))
  with check ((select private.ask_author(ask_id)) = (select auth.uid()));
create or replace function private.ask_answers_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (new.author_id <> old.author_id or new.set_id <> old.set_id or new.body <> old.body or new.ask_id <> old.ask_id) then
    raise exception 'only choosing is allowed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger ask_answers_guard before update on public.ask_answers for each row execute function private.ask_answers_guard();
create policy "ask_answers: author takes back" on public.ask_answers for delete to authenticated
  using (author_id = (select auth.uid()));

-- Notifications: an answer tells the asker; a chosen answer tells its author.
alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite', 'ask_answer', 'ask_chosen'));
alter table public.notifications drop constraint notifications_ref_type;
alter table public.notifications add constraint notifications_ref_type
  check (ref_type in ('set', 'poll', 'conversation', 'profile', 'group', 'ask'));
create or replace function private.notify_ask_answer() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify((select private.ask_author(new.ask_id)), 'ask_answer', new.author_id, 'ask', new.ask_id, true);
  return new;
end $$;
create trigger ask_answers_notify after insert on public.ask_answers for each row execute function private.notify_ask_answer();
create or replace function private.notify_ask_chosen() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.chosen and not old.chosen then
    perform private.notify(new.author_id, 'ask_chosen', (select private.ask_author(new.ask_id)), 'ask', new.ask_id, false);
  end if;
  return new;
end $$;
create trigger ask_answers_chosen after update on public.ask_answers for each row execute function private.notify_ask_chosen();
