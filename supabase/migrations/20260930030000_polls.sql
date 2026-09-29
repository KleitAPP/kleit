-- Migration 022 — "Which one?" polls (roadmap M3.7; spec 7.3; technical pack §1.4, §3 rows 19–21).
--
-- Three tables and one rule that shapes all of them: a vote is written by the server only.
-- Guests have no database connection at all - they hold a share code and talk to the
-- `cast-vote` function, which checks Turnstile and the per-device and per-network limits and
-- then calls `record_vote` here with the service key. Nobody, not even the poll's owner, reads
-- the `votes` table: the owner sees totals through the `poll_totals` view (spec 7.3 #8: no names).
--
-- Spec 7.3 #7: the options lock at the first vote; `reopen_poll` (owner only) clears the votes
-- and unlocks them, and the app warns before calling it. A poll closes at `closes_at` (default
-- 7 days, owner picks 1 hour to 30 days) or when the owner sets `closed_at`.
--
-- Spec 7.3 #9's "owner can hide a vote" waits for the moderation tools (M7): with totals only,
-- there is no vote on screen to point at yet. The `hidden` column is here so nothing moves later.

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  share_code text not null unique default private.new_share_code(),
  question text not null default '' check (char_length(question) <= 140),
  closes_at timestamptz not null default now() + interval '7 days',
  closed_at timestamptz,
  locked boolean not null default false,
  takedown_state public.takedown_state not null default 'none',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint polls_closes_window check (
    closes_at >= created_at + interval '55 minutes' and closes_at <= created_at + interval '30 days'
  )
);
alter table public.polls enable row level security;
revoke all on table public.polls from anon;
revoke delete, truncate on table public.polls from authenticated;
create index polls_owner_idx on public.polls (owner_id) where deleted_at is null;
create trigger polls_touch before update on public.polls
  for each row execute function private.touch_updated_at();

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  set_id uuid not null references public.sets (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 40),
  sort_order integer not null default 0 check (sort_order between 0 and 3),
  unique (poll_id, set_id),
  unique (poll_id, sort_order)
);
alter table public.poll_options enable row level security;
revoke all on table public.poll_options from anon;

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  option_id uuid not null references public.poll_options (id) on delete cascade,
  voter_id uuid references auth.users (id) on delete set null,
  device_hash text not null,
  ip_hash text,
  weight numeric(3, 2) not null default 1 check (weight >= 0 and weight <= 1),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poll_id, device_hash)
);
alter table public.votes enable row level security;
-- Server only (technical pack §3 row 21): no policy, no grant. The audit test lists it.
revoke all on table public.votes from anon, authenticated;
create index votes_poll_ip_idx on public.votes (poll_id, ip_hash, created_at);

-- Who may read a poll: its owner, or anyone allowed to see every set in it. Guests never come
-- this way; they come through `shared_poll` below.
create or replace function private.can_view_poll(p_poll_id uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.polls p
    where p.id = p_poll_id and p.deleted_at is null and p.takedown_state = 'none'
      and (
        p.owner_id = p_viewer
        or (p_viewer is not null
            and not (select private.blocked_either_way(p.owner_id, p_viewer))
            and not exists (
              select 1 from public.poll_options o
              where o.poll_id = p.id and not public.can_view_set(o.set_id, p_viewer)
            ))
      )
  );
$$;
revoke all on function private.can_view_poll(uuid, uuid) from public;
grant execute on function private.can_view_poll(uuid, uuid) to authenticated;

create or replace function private.owns_poll(p_poll_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.polls p where p.id = p_poll_id and p.owner_id = auth.uid() and p.deleted_at is null);
$$;
revoke all on function private.owns_poll(uuid) from public;
grant execute on function private.owns_poll(uuid) to authenticated;

create or replace function private.poll_is_locked(p_poll_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.locked from public.polls p where p.id = p_poll_id), true);
$$;
revoke all on function private.poll_is_locked(uuid) from public;
grant execute on function private.poll_is_locked(uuid) to authenticated;

create policy "polls: owner or whoever can view every set" on public.polls for select to authenticated
  using (owner_id = auth.uid() or (select private.can_view_poll(id, auth.uid())));
create policy "polls: owner creates" on public.polls for insert to authenticated
  with check (owner_id = auth.uid());
create policy "polls: owner changes" on public.polls for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- The server-only columns, guarded the way `sets_guard` guards a set's.
create or replace function private.polls_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin())
     or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.share_code is distinct from old.share_code
     or new.locked is distinct from old.locked
     or new.takedown_state is distinct from old.takedown_state then
    raise exception 'owner_id, share_code, locked and takedown_state are set by the server only'
      using errcode = '42501';
  end if;
  -- Once the first vote is in, the deadline is part of the deal (spec 7.3 #7). Closing early
  -- (`closed_at`) and deleting are still the owner's.
  if old.locked and new.closes_at is distinct from old.closes_at then
    raise exception 'the deadline cannot change after the first vote' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger polls_guard before update on public.polls
  for each row execute function private.polls_guard();

create policy "poll_options: whoever can read the poll" on public.poll_options for select to authenticated
  using ((select private.can_view_poll(poll_id, auth.uid())));
create policy "poll_options: owner adds before the first vote" on public.poll_options for insert to authenticated
  with check ((select private.owns_poll(poll_id)) and not (select private.poll_is_locked(poll_id)));
create policy "poll_options: owner changes before the first vote" on public.poll_options for update to authenticated
  using ((select private.owns_poll(poll_id)) and not (select private.poll_is_locked(poll_id)))
  with check ((select private.owns_poll(poll_id)) and not (select private.poll_is_locked(poll_id)));
create policy "poll_options: owner removes before the first vote" on public.poll_options for delete to authenticated
  using ((select private.owns_poll(poll_id)) and not (select private.poll_is_locked(poll_id)));

-- Two to four sets (spec 7.3 #1): the ceiling here, the floor in `record_vote` (a poll with one
-- option cannot take a vote) and in the app.
create or replace function private.poll_options_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.poll_options o where o.poll_id = new.poll_id) >= 4 then
    raise exception 'a poll compares at most four sets' using errcode = '23514';
  end if;
  -- The set must be the poll owner's own and published: you send your sets, not someone else's.
  if not exists (
    select 1 from public.sets s join public.polls p on p.owner_id = s.owner_id
    where s.id = new.set_id and p.id = new.poll_id and s.status = 'published' and s.deleted_at is null
  ) then
    raise exception 'only your own published sets can go in a poll' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger poll_options_guard before insert on public.poll_options
  for each row execute function private.poll_options_guard();

-- ---------------------------------------------------------------------------
-- Totals, never names (spec 7.3 #8). The view runs as its owner on purpose (no
-- security_invoker), so it can count the server-only votes; its WHERE hands the numbers to the
-- poll's owner and to a signed-in person who has voted, and to nobody else.
-- ---------------------------------------------------------------------------
create view public.poll_totals as
  select o.poll_id,
         o.id as option_id,
         coalesce(sum(v.weight) filter (where not v.hidden), 0)::numeric as votes,
         count(v.id) filter (where not v.hidden)::integer as raw_votes,
         count(v.id) filter (where not v.hidden and v.voter_id is not null
                              and private.are_friends(v.voter_id, p.owner_id))::integer as friend_votes
  from public.poll_options o
  join public.polls p on p.id = o.poll_id
  left join public.votes v on v.option_id = o.id
  where p.deleted_at is null
    and (p.owner_id = auth.uid()
         or exists (select 1 from public.votes me where me.poll_id = p.id and me.voter_id = auth.uid()))
  group by o.poll_id, o.id, p.owner_id;
revoke all on public.poll_totals from public, anon;
grant select on public.poll_totals to authenticated;

-- The same numbers as one JSON document, for the server (cast-vote hands them to a guest who
-- has just voted). Service role only.
create or replace function private.poll_totals_json(p_poll_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'option_id', o.id,
           'votes', coalesce((select sum(v.weight) from public.votes v where v.option_id = o.id and not v.hidden), 0),
           'raw_votes', (select count(*) from public.votes v where v.option_id = o.id and not v.hidden)
         ) order by o.sort_order), '[]'::jsonb)
  from public.poll_options o where o.poll_id = p_poll_id;
$$;
revoke all on function private.poll_totals_json(uuid) from public;

-- ---------------------------------------------------------------------------
-- What a guest sees: the poll and its sets, with nothing about the owner beyond their name, and
-- no totals - those come after the vote (spec 7.3 #3, decision 88). A wrong code, a deleted poll
-- and a taken-down poll all come back null, which is the same answer.
-- ---------------------------------------------------------------------------
create or replace function public.shared_poll(p_code text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id,
    'question', p.question,
    'closes_at', p.closes_at,
    'closed', p.closed_at is not null or p.closes_at <= now(),
    'owner', jsonb_build_object('username', pr.username, 'display_name', pr.display_name),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'label', o.label,
        'sort_order', o.sort_order,
        'set', jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'layout', s.layout,
          'pieces', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', i.id,
              'slot', (si.position ->> 'slot')::int,
              'kind', i.kind,
              'title', i.title,
              'price_cents', case when i.kind = 'product' then i.price_cents end,
              'price_currency', case when i.kind = 'product' then i.price_currency end,
              'pictured', (select private.image_cleared(i.id))
                          and (i.kind = 'product' or (select private.closet_says_shareable(i.id)))
            ) order by (si.position ->> 'slot')::int)
            from public.set_items si join public.items i on i.id = si.item_id
            where si.set_id = s.id and i.deleted_at is null and i.takedown_state = 'none'
          ), '[]'::jsonb)
        )
      ) order by o.sort_order)
      from public.poll_options o
      join public.sets s on s.id = o.set_id
      where o.poll_id = p.id and s.deleted_at is null and s.takedown_state = 'none'
    ), '[]'::jsonb)
  )
  from public.polls p
  join public.profiles pr on pr.user_id = p.owner_id
  where p.share_code = p_code and p.deleted_at is null and p.takedown_state = 'none'
  limit 1;
$$;
revoke all on function public.shared_poll(text) from public;
grant execute on function public.shared_poll(text) to anon, authenticated;

-- A piece on a set that sits in a live poll may be pictured for the poll's guests, the same way
-- a piece on a shared set may (migration 021): the owner chose to send it.
create or replace function public.piece_is_shareable(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i
    where i.id = p_item_id and i.deleted_at is null and i.takedown_state = 'none'
      and (select private.image_cleared(i.id))
      and (
        i.kind = 'product'
        or ((select private.closet_says_shareable(i.id)) and (
          exists (
            select 1 from public.set_items si join public.sets s on s.id = si.set_id
            where si.item_id = i.id and s.status = 'published' and s.deleted_at is null
              and s.takedown_state = 'none' and s.visibility in ('public', 'link')
          )
          or exists (
            select 1 from public.set_items si
            join public.poll_options o on o.set_id = si.set_id
            join public.polls p on p.id = o.poll_id
            where si.item_id = i.id and p.deleted_at is null and p.takedown_state = 'none'
          )
        ))
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- The vote itself. Service role only: `cast-vote` has already checked Turnstile and worked out
-- the device and network hashes; this function applies the rules that belong to the data.
--   * the poll must be open (not deleted, not taken down, not closed, deadline ahead) and have
--     at least two options, and the option must be one of its own;
--   * a blocked person cannot vote on your poll (spec 7.3 #9);
--   * one vote per device or account (the unique key) - voting again for the SAME option is
--     refused as `already_voted`, for a different one changes the vote (spec 7.3 #8);
--   * a network that has cast 20 votes on one poll in an hour is refused (`too_many_network`),
--     and past 5 its votes are down-weighted to half (spec 7.3 #6);
--   * the first vote locks the options (spec 7.3 #7).
-- Returns the totals, and whether this was a first vote or a change.
-- ---------------------------------------------------------------------------
create or replace function public.record_vote(
  p_poll_id uuid, p_option_id uuid, p_voter_id uuid, p_device_hash text, p_ip_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_poll public.polls%rowtype;
  v_existing public.votes%rowtype;
  v_from_network integer;
  v_weight numeric(3, 2) := 1;
  v_changed boolean := false;
begin
  select * into v_poll from public.polls p where p.id = p_poll_id;
  if v_poll.id is null or v_poll.deleted_at is not null or v_poll.takedown_state <> 'none' then
    raise exception 'not_found';
  end if;
  if v_poll.closed_at is not null or v_poll.closes_at <= now() then
    raise exception 'closed';
  end if;
  if (select count(*) from public.poll_options o where o.poll_id = p_poll_id) < 2 then
    raise exception 'not_ready';
  end if;
  if not exists (select 1 from public.poll_options o where o.id = p_option_id and o.poll_id = p_poll_id) then
    raise exception 'not_found';
  end if;
  if p_voter_id is not null and (select private.blocked_either_way(v_poll.owner_id, p_voter_id)) then
    raise exception 'blocked';
  end if;
  if p_device_hash is null or length(p_device_hash) < 16 then
    raise exception 'bad_device';
  end if;

  select count(*) into v_from_network from public.votes v
  where v.poll_id = p_poll_id and p_ip_hash is not null and v.ip_hash = p_ip_hash
    and v.created_at > now() - interval '1 hour' and v.device_hash <> p_device_hash;
  if v_from_network >= 20 then
    raise exception 'too_many_network';
  end if;
  if v_from_network >= 5 then
    v_weight := 0.5;
  end if;

  select * into v_existing from public.votes v where v.poll_id = p_poll_id and v.device_hash = p_device_hash;
  if v_existing.id is not null then
    if v_existing.option_id = p_option_id then
      raise exception 'already_voted';
    end if;
    update public.votes set option_id = p_option_id, updated_at = now(),
      voter_id = coalesce(p_voter_id, voter_id)
    where id = v_existing.id;
    v_changed := true;
  else
    insert into public.votes (poll_id, option_id, voter_id, device_hash, ip_hash, weight)
    values (p_poll_id, p_option_id, p_voter_id, p_device_hash, p_ip_hash, v_weight);
    if not v_poll.locked then
      perform set_config('kleit.server_write', '1', true);
      update public.polls set locked = true where id = p_poll_id;
      perform set_config('kleit.server_write', '0', true);
    end if;
  end if;

  return jsonb_build_object(
    'changed', v_changed,
    'option_id', p_option_id,
    'closes_at', v_poll.closes_at,
    'totals', (select private.poll_totals_json(p_poll_id))
  );
end $$;
revoke all on function public.record_vote(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_vote(uuid, uuid, uuid, text, text) to service_role;

-- Has this device voted already, and on what? For the shared page to show the bars straight
-- away to someone coming back (spec 7.3 #3). Service role only; null when it has not.
create or replace function public.vote_status(p_poll_id uuid, p_device_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'option_id', v.option_id,
    'closes_at', p.closes_at,
    'totals', (select private.poll_totals_json(p.id))
  )
  from public.votes v join public.polls p on p.id = v.poll_id
  where v.poll_id = p_poll_id and v.device_hash = p_device_hash and p.deleted_at is null
  limit 1;
$$;
revoke all on function public.vote_status(uuid, text) from public, anon, authenticated;
grant execute on function public.vote_status(uuid, text) to service_role;

-- Spec 7.3 #7: "editing resets votes (with a warning)". The owner's one way to unlock the
-- options: every vote goes, the poll unlocks, and the app has warned before calling this.
create or replace function public.reopen_poll(p_poll_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.polls p where p.id = p_poll_id and p.owner_id = auth.uid() and p.deleted_at is null) then
    return false;
  end if;
  delete from public.votes where poll_id = p_poll_id;
  perform set_config('kleit.server_write', '1', true);
  update public.polls set locked = false where id = p_poll_id;
  perform set_config('kleit.server_write', '0', true);
  return true;
end $$;
revoke all on function public.reopen_poll(uuid) from public, anon;
grant execute on function public.reopen_poll(uuid) to authenticated;
