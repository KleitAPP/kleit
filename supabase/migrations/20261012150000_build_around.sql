-- 100 · "Build around this piece" (spec 5.1 #12; roadmap M3.2's leftover): one piece locked,
-- friends fill the rest. It is an Ask (033) with a piece attached: the asker names a cleared
-- store piece, and every answer is a public set of the answerer's that carries that piece.
--
-- Why a store piece only: an answer is somebody else's set, and the only pieces another person
-- may put on their set are the catalogue's cleared store pieces (the set_items insert policy).
-- A piece of the asker's own could be locked but never placed by a friend - a challenge nobody
-- could enter.
alter table public.ask_posts add column item_id uuid references public.items (id) on delete set null;
comment on column public.ask_posts.item_id is 'The locked piece of a "build around this" question (migration 100); null for a plain question. A cleared store piece only.';
create index ask_posts_item_idx on public.ask_posts (item_id) where item_id is not null;

-- The asker may lock only a piece the world may put on a set.
drop policy "ask_posts: author asks" on public.ask_posts;
create policy "ask_posts: author asks" on public.ask_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      item_id is null
      or exists (
        select 1 from public.items i
        where i.id = item_id and i.kind = 'product' and i.deleted_at is null and i.takedown_state = 'none'
          and (select private.image_cleared(i.id))
      )
    )
  );

-- The locked piece is set once, with the question.
create or replace function private.ask_posts_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (
       new.author_id <> old.author_id or new.question <> old.question or new.created_at <> old.created_at
       or new.item_id is distinct from old.item_id) then
    raise exception 'only closing or removing a question is allowed' using errcode = '42501';
  end if;
  return new;
end $$;

-- An answer to a build-around carries the piece; everything else about answering is as it was
-- (033's text, plus the one clause).
drop policy "ask_answers: answer with your own public set" on public.ask_answers;
create policy "ask_answers: answer with your own public set" on public.ask_answers for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and chosen = false
    and exists (select 1 from public.sets s where s.id = set_id and s.owner_id = author_id and s.status = 'published' and s.visibility = 'public' and s.deleted_at is null)
    and exists (
      select 1 from public.ask_posts a
      where a.id = ask_id and a.closed_at is null and a.deleted_at is null
        and (
          a.item_id is null
          or exists (select 1 from public.set_items si where si.set_id = ask_answers.set_id and si.item_id = a.item_id)
        )
    )
    and not (select private.blocked_either_way((select private.ask_author(ask_id)), author_id))
  );
