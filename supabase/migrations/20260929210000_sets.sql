-- Migration 017 — sets, and the one question every set-shaped policy asks (roadmap M3.1;
-- technical pack §1.3, §2, §3 rows 13–18, 22, 24; design pack G1, G2; spec 5, 7).
--
-- What a set is: the collage. Who may see one is decided in exactly one place, the function
-- `can_view_set(set, viewer, code)`, and every policy that touches a set or anything hanging off
-- it (`set_items`, later comments and likes) asks that function rather than restating the rule.
-- Rule 2 of the technical pack: reads are never wider than the set's visibility.
--
-- The grid the function implements (technical pack §2):
--
--   visibility   signed out        stranger      follower   friend   owner
--   public       ✅ via share page  ✅            ✅          ✅        ✅
--   link         ✅ only with code  ✅ with code  ✅ w/ code  ✅ w/code ✅
--   followers    ❌                ❌            ✅          ✅        ✅
--   friends      ❌                ❌            ❌          ✅        ✅
--   only_me      ❌                ❌            ❌          ❌        ✅
--   draft        ❌                ❌            ❌          ❌        ✅
--   blocked      ❌ either way, whatever the visibility (the owner still sees their own)
--
-- Two tables from M5 arrive early because the grid cannot be answered without them: `follows`
-- and `blocks` (rows 22 and 24). They come with their own policies; `follow_requests` and
-- `mutes` still belong to M5.
--
-- Also here, because they were owed: the `public_item_stats` view (design pack G2, moved from
-- M2.2 — it counts public sets, which did not exist), the items policy that lets a set's viewers
-- see a shareable "own" piece on it (row 7), and the `clicks.set_id` reference (migration 015).
--
-- Not here, on purpose: polls (M3.7), and the share Worker's guest path (M3.9) - although the
-- function it will call, `set_by_share_code`, is written now so the rule lives in one place.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.set_status as enum ('draft', 'published');
create type public.set_visibility as enum ('public', 'link', 'followers', 'friends', 'only_me');
create type public.comments_mode as enum ('everyone', 'followers', 'off');
create type public.remix_mode as enum ('anyone', 'followers', 'off');
create type public.collection_visibility as enum ('public', 'only_me');
create type public.template_kind as enum ('slot', 'stacked');

-- ---------------------------------------------------------------------------
-- 22. follows — row 22: anyone signed in reads (respecting private accounts and blocks);
--     the follower creates; the follower, or the followee ("remove follower"), deletes.
--     Private accounts go through follow_requests (M5); until then a follow of a private
--     account is refused outright rather than silently allowed.
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
alter table public.follows enable row level security;
revoke all on table public.follows from anon;
revoke update, truncate on table public.follows from authenticated;
create index follows_followee_idx on public.follows (followee_id);

-- ---------------------------------------------------------------------------
-- 24. blocks — row 24: owner only, all the way through. The blocked person is never told.
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
revoke all on table public.blocks from anon;
revoke update, truncate on table public.blocks from authenticated;
create index blocks_blocked_idx on public.blocks (blocked_id);

create policy "blocks: owner reads" on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy "blocks: owner creates" on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy "blocks: owner deletes" on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- The three relationship questions, answered without letting the caller read either table.
create or replace function private.blocked_either_way(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks x
    where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a)
  );
$$;
create or replace function private.is_following(follower uuid, followee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select follower is not null and exists (
    select 1 from public.follows f where f.follower_id = follower and f.followee_id = followee
  );
$$;
create or replace function private.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.is_following(a, b)) and (select private.is_following(b, a));
$$;
revoke all on function private.blocked_either_way(uuid, uuid), private.is_following(uuid, uuid), private.are_friends(uuid, uuid) from public;
grant execute on function private.blocked_either_way(uuid, uuid), private.is_following(uuid, uuid), private.are_friends(uuid, uuid) to authenticated, anon;

-- follows policies need blocks and private accounts, so they come after the helpers.
create policy "follows: signed-in read" on public.follows for select to authenticated
  using (
    not (select private.blocked_either_way((select auth.uid()), follower_id))
    and not (select private.blocked_either_way((select auth.uid()), followee_id))
  );
create policy "follows: follower creates" on public.follows for insert to authenticated
  with check (
    follower_id = (select auth.uid())
    and not (select private.blocked_either_way(follower_id, followee_id))
    -- A private account is followed by request (M5). Until requests exist, refuse.
    and not exists (select 1 from public.profiles p where p.user_id = followee_id and p.is_private)
    and exists (select 1 from public.profiles p where p.user_id = followee_id and p.deactivated_at is null)
  );
create policy "follows: either side deletes" on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 13. sets — row 13: read by can_view_set; owner creates and changes; delete is a timestamp
--     (30 days, Recently deleted) or the server on a takedown.
-- ---------------------------------------------------------------------------
create or replace function private.new_share_code()
returns text language sql volatile set search_path = '' as $$
  -- 16 characters of base-62 from 12 random bytes: 95 bits, unguessable, URL-safe.
  select string_agg(
    substr('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', (get_byte(b, i) % 62) + 1, 1), '')
  from (select extensions.gen_random_bytes(16) as b) r, generate_series(0, 15) as i;
$$;
revoke all on function private.new_share_code() from public;
-- The column default runs as whoever inserts, so the person making a set needs this.
grant execute on function private.new_share_code() to authenticated;

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '' check (char_length(title) <= 80),
  caption text not null default '' check (char_length(caption) <= 280),
  description text not null default '' check (char_length(description) <= 1000),
  tags text[] not null default '{}' check (array_length(tags, 1) is null or array_length(tags, 1) <= 20),
  layout jsonb not null default '{}'::jsonb,
  layout_version integer not null default 1,
  status public.set_status not null default 'draft',
  visibility public.set_visibility not null default 'public',
  share_code text not null unique default private.new_share_code(),
  preview_image_id text,
  alt_text text check (alt_text is null or char_length(alt_text) <= 300),
  -- Design pack G1: the song card.
  song_url text,
  song_title text,
  song_artist text,
  song_cover_url text,
  comments_mode public.comments_mode not null default 'everyone',
  remix_mode public.remix_mode not null default 'anyone',
  remixed_from_set_id uuid references public.sets (id) on delete set null,
  remixed_from_label text,
  takedown_state public.takedown_state not null default 'none',
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.sets enable row level security;
revoke all on table public.sets from anon;
revoke delete, truncate on table public.sets from authenticated;
create index sets_owner_idx on public.sets (owner_id) where deleted_at is null;
create index sets_public_idx on public.sets (published_at desc)
  where status = 'published' and visibility = 'public' and deleted_at is null and takedown_state = 'none';

create trigger sets_touch before update on public.sets
  for each row execute function private.touch_updated_at();

-- The one question. `p_code` is the share code, when the viewer arrived by a link; it opens a
-- `link` set (and a public one) to anyone who holds it, which is what a link means.
create or replace function public.can_view_set(p_set_id uuid, p_viewer uuid, p_code text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sets s
    where s.id = p_set_id
      and s.takedown_state = 'none'
      and (
        -- The owner sees their own, drafts and deleted-for-30-days included.
        s.owner_id = p_viewer
        or (
          s.status = 'published'
          and s.deleted_at is null
          and not (select private.blocked_either_way(p_viewer, s.owner_id))
          and (
            s.visibility = 'public'
            or (s.visibility = 'link' and p_code is not null and s.share_code = p_code)
            or (s.visibility = 'public' and p_code is not null and s.share_code = p_code)
            or (s.visibility = 'followers' and (select private.is_following(p_viewer, s.owner_id)))
            or (s.visibility = 'friends' and (select private.are_friends(p_viewer, s.owner_id)))
          )
        )
      )
  );
$$;
revoke all on function public.can_view_set(uuid, uuid, text) from public;
grant execute on function public.can_view_set(uuid, uuid, text) to authenticated, anon;

create policy "sets: whoever can view" on public.sets for select to authenticated
  using ((select public.can_view_set(id, (select auth.uid()))));
create policy "sets: owner creates" on public.sets for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "sets: owner changes" on public.sets for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
-- No delete policy. Deleting is `deleted_at`; Recently deleted keeps it 30 days (S26).

-- The columns a person may not change on their own set: the server's.
create or replace function private.sets_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Not a person, an admin, or one of our own server-side functions (which say so for the
  -- length of their transaction): these columns are their job.
  if (select auth.uid()) is null or (select private.is_admin())
     or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.takedown_state is distinct from old.takedown_state
     or new.share_code is distinct from old.share_code then
    raise exception 'owner_id, takedown_state and share_code are set by the server only';
  end if;
  -- Publishing stamps the time once; unpublishing does not erase it.
  if new.status = 'published' and old.status = 'draft' then
    new.published_at := coalesce(old.published_at, now());
  end if;
  return new;
end;
$$;
create trigger sets_guard before update on public.sets
  for each row execute function private.sets_guard();

-- "Reset share link" (S49): a new code, through the server, so the old link dies.
create or replace function public.reset_share_code(p_set_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not exists (select 1 from public.sets s where s.id = p_set_id and s.owner_id = (select auth.uid())) then
    raise exception 'not your set' using errcode = '42501';
  end if;
  v_code := private.new_share_code();
  perform set_config('kleit.server_write', '1', true);
  update public.sets set share_code = v_code where id = p_set_id;
  perform set_config('kleit.server_write', '0', true);
  return v_code;
end;
$$;
revoke all on function public.reset_share_code(uuid) from public, anon;
grant execute on function public.reset_share_code(uuid) to authenticated;

-- The guest path (M3.9's Worker and the signed-in "opened by link" case): a published public or
-- link set, by its code. Returns nothing at all otherwise - the same answer as a wrong code.
create or replace function public.set_by_share_code(p_code text)
returns setof public.sets
language sql stable security definer set search_path = '' as $$
  select s.* from public.sets s
  where s.share_code = p_code
    and s.status = 'published'
    and s.deleted_at is null
    and s.takedown_state = 'none'
    and s.visibility in ('public', 'link')
    and not (select private.blocked_either_way((select auth.uid()), s.owner_id))
  limit 1;
$$;
revoke all on function public.set_by_share_code(text) from public;
grant execute on function public.set_by_share_code(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 14. set_items — row 14: whoever can view the parent set reads; the set owner writes.
-- ---------------------------------------------------------------------------
create table public.set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete restrict,
  position jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (set_id, item_id)
);
alter table public.set_items enable row level security;
revoke all on table public.set_items from anon;
revoke truncate on table public.set_items from authenticated;
create index set_items_set_idx on public.set_items (set_id);
create index set_items_item_idx on public.set_items (item_id);

create or replace function private.owns_set(p_set_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sets s where s.id = p_set_id and s.owner_id = (select auth.uid()));
$$;
revoke all on function private.owns_set(uuid) from public;
grant execute on function private.owns_set(uuid) to authenticated;

create policy "set_items: whoever can view the set" on public.set_items for select to authenticated
  using ((select public.can_view_set(set_id, (select auth.uid()))));
create policy "set_items: set owner creates" on public.set_items for insert to authenticated
  with check (
    (select private.owns_set(set_id))
    -- Only a piece the owner may see can go on their set: their own, or a cleared product.
    and exists (select 1 from public.items i where i.id = item_id)
  );
create policy "set_items: set owner changes" on public.set_items for update to authenticated
  using ((select private.owns_set(set_id))) with check ((select private.owns_set(set_id)));
create policy "set_items: set owner deletes" on public.set_items for delete to authenticated
  using ((select private.owns_set(set_id)));

-- ---------------------------------------------------------------------------
-- 15. set_versions — row 15: owner reads; the server writes on save; nobody changes; the
--     server trims (last 20, 30 days).
-- ---------------------------------------------------------------------------
create table public.set_versions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.sets (id) on delete cascade,
  layout jsonb not null,
  saved_at timestamptz not null default now()
);
alter table public.set_versions enable row level security;
revoke all on table public.set_versions from anon;
revoke insert, update, delete, truncate on table public.set_versions from authenticated;
create index set_versions_set_idx on public.set_versions (set_id, saved_at desc);

create policy "set_versions: owner reads" on public.set_versions for select to authenticated
  using ((select private.owns_set(set_id)));

-- Autosave (M3.2, guardrail 1): the app hands the layout to this, which writes the set AND the
-- version in one go, then trims. The app never writes set_versions itself, so a version is
-- always a real save.
create or replace function public.save_set_layout(p_set_id uuid, p_layout jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_version integer;
begin
  if not (select private.owns_set(p_set_id)) then
    raise exception 'not your set' using errcode = '42501';
  end if;
  update public.sets
    set layout = p_layout, layout_version = layout_version + 1
    where id = p_set_id
    returning layout_version into v_version;
  insert into public.set_versions (set_id, layout) values (p_set_id, p_layout);
  delete from public.set_versions v
    where v.set_id = p_set_id
      and (v.saved_at < now() - interval '30 days'
           or v.id not in (select id from public.set_versions where set_id = p_set_id order by saved_at desc limit 20));
  return v_version;
end;
$$;
revoke all on function public.save_set_layout(uuid, jsonb) from public, anon;
grant execute on function public.save_set_layout(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 16, 17. collections and their entries — rows 16 and 17.
-- ---------------------------------------------------------------------------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  visibility public.collection_visibility not null default 'only_me',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.collections enable row level security;
revoke all on table public.collections from anon;
revoke truncate on table public.collections from authenticated;
create index collections_owner_idx on public.collections (owner_id);
create trigger collections_touch before update on public.collections
  for each row execute function private.touch_updated_at();

create or replace function private.can_read_collection(p_collection_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.collections c
    where c.id = p_collection_id
      and (c.owner_id = (select auth.uid())
           or (c.visibility = 'public' and not (select private.blocked_either_way((select auth.uid()), c.owner_id))))
  );
$$;
revoke all on function private.can_read_collection(uuid) from public;
grant execute on function private.can_read_collection(uuid) to authenticated;

create policy "collections: owner or public" on public.collections for select to authenticated
  using ((select private.can_read_collection(id)));
create policy "collections: owner creates" on public.collections for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "collections: owner changes" on public.collections for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "collections: owner deletes" on public.collections for delete to authenticated
  using (owner_id = (select auth.uid()));

create table public.collection_entries (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections (id) on delete cascade,
  set_id uuid references public.sets (id) on delete cascade,
  item_id uuid references public.items (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint collection_entry_one_thing check ((set_id is null) <> (item_id is null)),
  unique (collection_id, set_id),
  unique (collection_id, item_id)
);
alter table public.collection_entries enable row level security;
revoke all on table public.collection_entries from anon;
revoke truncate on table public.collection_entries from authenticated;
create index collection_entries_collection_idx on public.collection_entries (collection_id);

create or replace function private.owns_collection(p_collection_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.collections c where c.id = p_collection_id and c.owner_id = (select auth.uid()));
$$;
revoke all on function private.owns_collection(uuid) from public;
grant execute on function private.owns_collection(uuid) to authenticated;

-- Row 17: whoever can read the collection AND the linked set or item. The item half is the
-- items table's own read policy, applied by the join.
create policy "collection_entries: readable collection and viewable thing" on public.collection_entries
  for select to authenticated
  using (
    (select private.can_read_collection(collection_id))
    and (set_id is null or (select public.can_view_set(set_id, (select auth.uid()))))
    and (item_id is null or exists (select 1 from public.items i where i.id = item_id))
  );
create policy "collection_entries: owner creates" on public.collection_entries for insert to authenticated
  with check ((select private.owns_collection(collection_id)));
create policy "collection_entries: owner changes" on public.collection_entries for update to authenticated
  using ((select private.owns_collection(collection_id))) with check ((select private.owns_collection(collection_id)));
create policy "collection_entries: owner deletes" on public.collection_entries for delete to authenticated
  using ((select private.owns_collection(collection_id)));

-- ---------------------------------------------------------------------------
-- 18. templates — row 18: anyone signed in reads ours (owner null) or public ones; owner reads
--     and writes their own.
-- ---------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  layout jsonb not null,
  kind public.template_kind not null default 'slot',
  is_public boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.templates enable row level security;
revoke all on table public.templates from anon;
revoke truncate on table public.templates from authenticated;

create policy "templates: ours, public, or own" on public.templates for select to authenticated
  using (owner_id is null or is_public or owner_id = (select auth.uid()));
create policy "templates: owner creates" on public.templates for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "templates: owner changes" on public.templates for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "templates: owner deletes" on public.templates for delete to authenticated
  using (owner_id = (select auth.uid()));

-- The four Quick-mode templates we ship (design pack S43). Slots are fractions of the canvas.
insert into public.templates (owner_id, name, layout, kind, is_public, sort_order) values
  (null, '3 pieces', '{"canvas":{"w":1080,"h":1350},"slots":[{"x":0.06,"y":0.06,"w":0.56,"h":0.56},{"x":0.62,"y":0.20,"w":0.34,"h":0.34},{"x":0.20,"y":0.60,"w":0.60,"h":0.36}]}', 'slot', true, 1),
  (null, '4 pieces', '{"canvas":{"w":1080,"h":1350},"slots":[{"x":0.05,"y":0.05,"w":0.44,"h":0.44},{"x":0.51,"y":0.05,"w":0.44,"h":0.44},{"x":0.05,"y":0.51,"w":0.44,"h":0.44},{"x":0.51,"y":0.51,"w":0.44,"h":0.44}]}', 'slot', true, 2),
  (null, 'Flat lay', '{"canvas":{"w":1080,"h":1350},"slots":[{"x":0.08,"y":0.05,"w":0.84,"h":0.42},{"x":0.05,"y":0.50,"w":0.30,"h":0.30},{"x":0.35,"y":0.50,"w":0.30,"h":0.30},{"x":0.65,"y":0.50,"w":0.30,"h":0.30},{"x":0.20,"y":0.80,"w":0.60,"h":0.17}]}', 'slot', true, 3),
  (null, 'Full look', '{"canvas":{"w":1080,"h":1350},"slots":[{"x":0.25,"y":0.03,"w":0.50,"h":0.30},{"x":0.20,"y":0.33,"w":0.60,"h":0.36},{"x":0.28,"y":0.69,"w":0.44,"h":0.28}]}', 'stacked', true, 4);

-- ---------------------------------------------------------------------------
-- Owed from M2: the items policy for a shared "own" piece (row 7), public_item_stats (G2),
-- and clicks.set_id.
-- ---------------------------------------------------------------------------
-- A person's own piece on a set they shared is visible to the set's viewers, but only if the
-- closet row says it may be (`closet_items.shareable`, default false), and only if it has passed
-- screening like everything else.
create policy "items: viewers of a set read shareable own pieces" on public.items
  for select to authenticated
  using (
    kind = 'own'
    and deleted_at is null
    and takedown_state = 'none'
    and (select private.image_cleared(id))
    and exists (
      select 1 from public.closet_items ci
      where ci.item_id = items.id and ci.shareable and ci.deleted_at is null
    )
    and exists (
      select 1 from public.set_items si
      where si.item_id = items.id and (select public.can_view_set(si.set_id, (select auth.uid())))
    )
  );

-- Design pack G2: "Sets with this item", counting only public published sets - never a raw
-- count off set_items, which would leak the existence of private sets. The view runs as its
-- owner on purpose (no security_invoker), so it sees every set and counts only the public ones.
create view public.public_item_stats as
  select si.item_id, count(*)::integer as set_count
  from public.set_items si
  join public.sets s on s.id = si.set_id
  where s.status = 'published' and s.visibility = 'public' and s.deleted_at is null and s.takedown_state = 'none'
  group by si.item_id;
revoke all on public.public_item_stats from public, anon;
grant select on public.public_item_stats to authenticated;

alter table public.clicks
  add constraint clicks_set_fk foreign key (set_id) references public.sets (id) on delete set null;
