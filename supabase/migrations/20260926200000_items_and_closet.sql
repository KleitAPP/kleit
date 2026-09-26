-- Migration 010 — items and the closet (roadmap M2.2; technical pack §1.2, §3 rows 7–12, §6A).
--
-- Numbering note: the technical pack calls this "003" in its migration order because it counts
-- migrations by waypoint. Our files are numbered in the order they actually ran, and M1.7 needed
-- seven of them to get the username rule right. This file IS technical-pack 003. The pack's 004
-- (the `public_item_stats` view) CANNOT be created here - it counts public sets, and `sets` does
-- not exist until M3.1. It moves to that migration; see the note at the bottom of this file.
--
-- Every table: RLS switched on IN THIS FILE, with its policies, never later (spec 15.2 #3).
-- Server-only tables get RLS on, NO policy, and their privileges revoked from the API roles.
-- "Server" = edge functions using the secret key, which bypasses RLS by design.
--
-- The one rule that shapes every read policy here: **nothing with an image is visible to anybody
-- but its owner until the image has been scanned** (spec 13.1, 16; roadmap M2.5). That gate is
-- built in from the first row rather than added later, because "add the safety check afterwards"
-- is how an unscanned photo reaches a stranger. It means an item is invisible to other people
-- until `item_flags` says `clean`, and until M2.5's `ingest-image` exists nothing writes those
-- rows - so M2.4's screens will only show a clipped item to the person who clipped it. That is
-- the correct failure direction, and it is a question for the owner at the M2 gate: **M2.4 and
-- M2.5 probably want to swap places in the roadmap.**

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.item_kind as enum ('product', 'non_product', 'own');
create type public.takedown_state as enum ('none', 'requested', 'removed');
create type public.scan_state as enum ('pending', 'clean', 'review', 'blocked');
create type public.drawer_origin as enum ('clipped', 'own_cutout', 'pickup');
create type public.optout_source as enum ('form', 'meta_tag');

-- ---------------------------------------------------------------------------
-- 10. item_flags — the screening result for an item's image (permissions row 10:
--     read server + moderators; create/change/delete server only).
--     Created BEFORE `items` because every read policy on `items` asks it a question.
-- ---------------------------------------------------------------------------
create table public.item_flags (
  item_id uuid primary key,
  scan_state public.scan_state not null default 'pending',
  labels jsonb not null default '{}'::jsonb,
  scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.item_flags enable row level security;
revoke all on table public.item_flags from anon;
revoke insert, update, delete, truncate on table public.item_flags from authenticated;

create or replace function private.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = (select auth.uid()) and r.role in ('admin', 'moderator')
  );
$$;
revoke all on function private.is_moderator() from public;
grant execute on function private.is_moderator() to authenticated;

create policy "item_flags: moderators read" on public.item_flags
  for select to authenticated
  using ((select private.is_moderator()));

create trigger item_flags_touch before update on public.item_flags
  for each row execute function private.touch_updated_at();

-- Answers "has this item's image been cleared?" without letting the caller read item_flags.
-- It takes an argument, which is safe here because the answer is one boolean about a row the
-- caller is already trying to read, and it leaks nothing about a person (security plan #8).
create or replace function private.image_cleared(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.item_flags f
    where f.item_id = p_item_id and f.scan_state = 'clean'
  );
$$;
revoke all on function private.image_cleared(uuid) from public;
grant execute on function private.image_cleared(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. items — the shared catalog: every clipped or uploaded piece (spec 2.5 #4).
--     Permissions row 7: read anyone signed in for `product`; `own` only the owner or, if
--     shareable, viewers of a set it is on; guests via a function. Create a signed-in user's
--     own rows. Change the owner, EXCEPT source_url / image_hash / takedown_state, which are
--     the server's. Delete the owner (soft), or the server on a takedown.
--
--     Two parts of that row cannot be written yet and are deliberately left CLOSED rather than
--     approximated: the set-viewer read needs `can_view_set()` (M3.1), and the guest read needs
--     the share Worker's function (M3.9). Until then only the owner sees a non-product item.
-- ---------------------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind public.item_kind not null,
  title text,
  price_cents integer check (price_cents is null or price_cents >= 0),
  price_currency text check (price_currency is null or price_currency ~ '^[A-Z]{3}$'),
  price_checked_at timestamptz,
  store_name text,
  -- Locked: the row records where the picture came from and that never changes (decision 103).
  source_url text,
  source_domain text,
  image_id text,
  image_hash text,
  sold_out boolean not null default false,
  takedown_state public.takedown_state not null default 'none',
  color_name text,
  alt_text text,
  credit text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.items enable row level security;
revoke all on table public.items from anon;
create index items_owner_idx on public.items (owner_id) where deleted_at is null;
create index items_domain_idx on public.items (source_domain);
create index items_hash_idx on public.items (image_hash);

create policy "items: owner reads own" on public.items
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- The catalog read. Three conditions, all required: it is a product, its image has been
-- cleared, and it is neither deleted nor taken down.
create policy "items: signed-in read cleared products" on public.items
  for select to authenticated
  using (
    kind = 'product'
    and deleted_at is null
    and takedown_state = 'none'
    and (select private.image_cleared(id))
  );

create policy "items: owner creates own" on public.items
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "items: owner updates own" on public.items
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- No delete policy at all: deleting is setting `deleted_at`, so a row can never be destroyed
-- by the app. A stored image with no item row is exactly the orphan decision 103 forbids.

-- The three server-only columns. A trigger is the only way to defend a column against its own
-- owner: a policy can say who may update the row, not which columns they may touch.
create or replace function private.items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select private.is_admin()) then
    return new;
  end if;
  if new.source_url is distinct from old.source_url
     or new.image_hash is distinct from old.image_hash
     or new.takedown_state is distinct from old.takedown_state
     or new.owner_id is distinct from old.owner_id then
    raise exception 'source_url, image_hash, takedown_state and owner_id are set by the server only';
  end if;
  return new;
end;
$$;
create trigger items_guard before update on public.items
  for each row execute function private.items_guard();

create trigger items_touch before update on public.items
  for each row execute function private.touch_updated_at();

alter table public.item_flags
  add constraint item_flags_item_fk foreign key (item_id) references public.items (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 8. closet_items — pieces the user owns, private by default (design-pack G3: Recently
--     deleted covers the closet too, so `deleted_at` is here from the start).
--     Permissions row 8: owner for all four.
-- ---------------------------------------------------------------------------
create table public.closet_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  notes text,
  shareable boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_id)
);
alter table public.closet_items enable row level security;
revoke all on table public.closet_items from anon;
create index closet_items_user_idx on public.closet_items (user_id) where deleted_at is null;

create policy "closet_items: owner reads" on public.closet_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "closet_items: owner creates" on public.closet_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "closet_items: owner updates" on public.closet_items
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "closet_items: owner deletes" on public.closet_items
  for delete to authenticated using (user_id = (select auth.uid()));

create trigger closet_items_touch before update on public.closet_items
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9. saved_items — hearted items, "My items". Permissions row 9: owner for all four.
-- ---------------------------------------------------------------------------
create table public.saved_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.saved_items enable row level security;
revoke all on table public.saved_items from anon;

create policy "saved_items: owner reads" on public.saved_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "saved_items: owner creates" on public.saved_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "saved_items: owner deletes" on public.saved_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 10a. drawer_items — the personal drawer (decision 103). Same permissions as the closet:
--      it is a private list of what this person clipped, cut out, or picked up.
--
--      A pickup NEVER copies an image. It writes a row here pointing at the existing item,
--      which is why `clip_records.trigger` has no `pickup` value. The set link is left
--      unconstrained until `sets` exists at M3.1, then a foreign key is added.
-- ---------------------------------------------------------------------------
create table public.drawer_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.items (id) on delete cascade,
  origin public.drawer_origin not null,
  picked_up_from_set_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, item_id),
  -- A pickup has to say where it came from; the other two must not pretend they did.
  constraint drawer_pickup_has_source check (
    (origin = 'pickup' and picked_up_from_set_id is not null)
    or (origin <> 'pickup' and picked_up_from_set_id is null)
  )
);
alter table public.drawer_items enable row level security;
revoke all on table public.drawer_items from anon;
create index drawer_items_user_idx on public.drawer_items (user_id);

create policy "drawer_items: owner reads" on public.drawer_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "drawer_items: owner creates" on public.drawer_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "drawer_items: owner deletes" on public.drawer_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 11. removed_image_fingerprints — images that may never come back.
--     Permissions row 11: server only, all four. RLS on, no policy, privileges revoked.
--     Nobody may read this: the list itself would tell someone which picture to try next.
-- ---------------------------------------------------------------------------
create table public.removed_image_fingerprints (
  image_hash text primary key,
  reason text not null,
  added_at timestamptz not null default now()
);
alter table public.removed_image_fingerprints enable row level security;
revoke all on table public.removed_image_fingerprints from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. optout_sites — the "don't clip my site" list, plus `nopin` domains.
--     Permissions row 12: anyone signed in reads; the server writes.
--     Readable on purpose: the app has to be able to say "this site asked not to be clipped"
--     before it fetches anything, and the list is public information about sites, not people.
-- ---------------------------------------------------------------------------
create table public.optout_sites (
  domain text primary key,
  source public.optout_source not null,
  added_at timestamptz not null default now()
);
alter table public.optout_sites enable row level security;
revoke insert, update, delete, truncate on table public.optout_sites from anon, authenticated;

create policy "optout_sites: signed-in read" on public.optout_sites
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Still to come, written here so it is not forgotten:
--   * `public_item_stats` (technical pack 004, design-pack G2) counts only public published
--     sets, so it belongs in the `sets` migration at M3.1 - it cannot exist before its tables.
--   * `items`' set-viewer read policy needs `can_view_set()` (M3.1) and the guest read needs
--     the share function (M3.9). Both are deliberately closed until then.
--   * `clip_records` lands at M2.3, BEFORE the first image is ever stored (decision 103).
-- ---------------------------------------------------------------------------
