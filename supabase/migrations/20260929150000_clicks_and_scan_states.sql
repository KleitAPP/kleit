-- Migration 015 — `clicks`, and a way for a person to see whether their own photo has passed
-- (roadmap M2.7; technical pack §1.9 and §6A #006; spec 8.2 #13).
--
-- Two things, both small, both about what a row is allowed to know.
--
-- 1. `clicks`. A Buy tap is recorded so that a store can pay a commission and so we can tell
--    which items people actually want. The row holds a random id, the item, the set it was on
--    (when there is one), the network and the time. **It never holds who tapped** - there is no
--    user column to leave empty, because a column that exists will one day be filled. Only the
--    server writes it (the redirect function) and only an admin reads it.
--
-- 2. `my_items_scan_states`. Screening results live in `item_flags`, which a person may not read
--    - it holds the scanner's reasons, which are not theirs. But "is my jumper still being
--    checked?" is a fair question with a one-word answer, so this function gives exactly that
--    word, for exactly the items the caller owns, and nothing else. Anyone else's item comes
--    back as no row at all, which is the same answer as an item that does not exist.

-- ---------------------------------------------------------------------------
-- 1. clicks — permissions row: create server only; read admins; nobody changes or deletes.
-- ---------------------------------------------------------------------------
create table public.clicks (
  click_id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  -- `sets` does not exist until M3.1; the reference is added there. Nullable on purpose: a tap
  -- from an item page has no set.
  set_id uuid,
  network text not null default 'direct' check (network ~ '^[a-z0-9_-]{1,32}$'),
  created_at timestamptz not null default now()
);
alter table public.clicks enable row level security;
revoke all on table public.clicks from anon;
revoke insert, update, delete, truncate on table public.clicks from authenticated;
create index clicks_item_idx on public.clicks (item_id, created_at desc);

create policy "clicks: admins read" on public.clicks
  for select to authenticated
  using ((select private.is_admin()));
-- No insert, update or delete policy for any person. The service key bypasses RLS, and the
-- redirect function is the only thing that holds it.

-- ---------------------------------------------------------------------------
-- 2. What a person may know about their own screening
-- ---------------------------------------------------------------------------
create or replace function public.my_items_scan_states(p_item_ids uuid[])
returns table (item_id uuid, scan_state text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, coalesce(f.scan_state::text, 'pending')
  from public.items i
  left join public.item_flags f on f.item_id = i.id
  where i.id = any (p_item_ids)
    and i.owner_id = (select auth.uid())
$$;
revoke all on function public.my_items_scan_states(uuid[]) from public, anon;
grant execute on function public.my_items_scan_states(uuid[]) to authenticated;
