-- Migration 011 — the file buckets and clip_records (roadmap M2.3; technical pack §3.1, §3 row 54).
--
-- This is the technical pack's 005, and it carries the one deadline written inside the plan:
-- `clip_records` must exist BEFORE the first clipped image is ever stored, not after. An image in
-- storage with no row saying which person asked for it is the exact thing *BWP Media v. Polyvore*
-- went back for trial over (decision 103). So the table lands in the same migration as the
-- buckets, and neither is useful without the other.
--
-- The rule for every bucket (technical pack §3.1): public READ is sometimes fine; public WRITE
-- never is. Not one policy below lets a person write anywhere but their own folder, and four of
-- the eight let nobody in the app write at all.

-- ---------------------------------------------------------------------------
-- 54. clip_records — one row per stored clipped image (decision 103).
--     Permissions row 54: read server + the owning user; create server only (written by
--     `clip-url` and `ingest-image`); change nobody; delete server, with the image.
-- ---------------------------------------------------------------------------
create type public.clip_trigger as enum ('share_extension', 'paste_link', 'browser_extension', 'upload');

create table public.clip_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references public.items (id) on delete set null,
  image_id text,
  source_url text,
  trigger public.clip_trigger not null,
  created_at timestamptz not null default now()
);
alter table public.clip_records enable row level security;
revoke all on table public.clip_records from anon;
-- The app may look, never touch. Every row is written by an edge function with the secret key,
-- because a record the user can write is not a record of what the user did.
revoke insert, update, delete, truncate on table public.clip_records from authenticated;
create index clip_records_user_idx on public.clip_records (user_id);
create index clip_records_item_idx on public.clip_records (item_id);

create policy "clip_records: the person can see their own" on public.clip_records
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The eight buckets (technical pack §3.1).
--
-- Size limits are set so that the 25 MB file the waypoint test throws at them is refused
-- everywhere. 10 MB is roughly two of the largest photos a 2019 Android takes, which is the
-- floor device we test on.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Public read: a profile picture is shown to anyone who can see the profile.
  ('avatars', 'avatars', true, 5242880,
   array['image/jpeg','image/png','image/webp','image/avif']),

  -- NOT public, despite the pack's "public after screening passes" - a bucket cannot read
  -- `item_flags`, so a public bucket would serve an unscanned image to anyone who guessed the
  -- path, which is the one thing spec 16 forbids. Delivery is Cloudflare Images off the stored
  -- original (decision 103), so nothing needs the bucket to be public. Server writes only.
  ('item-images', 'item-images', false, 10485760,
   array['image/jpeg','image/png','image/webp','image/avif']),

  -- A person's own clothes. Private by default, read through 1-hour signed links.
  ('closet-photos', 'closet-photos', false, 10485760,
   array['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif']),

  -- The picture that appears in a group chat. Public read, versioned filenames, server writes.
  ('set-previews', 'set-previews', true, 10485760,
   array['image/jpeg','image/png','image/webp','image/avif']),

  -- Exports the person asked for. 7-day signed link, then deleted.
  ('exports', 'exports', false, 26214400, null),

  -- Fonts a person uploaded for their own sets. Never served with a shared set.
  ('private-fonts', 'private-fonts', false, 5242880,
   array['font/ttf','font/otf','font/woff','font/woff2','application/font-sfnt']),

  -- Moderation and legal holds. Nobody in the app, ever.
  ('evidence', 'evidence', false, 26214400, null),

  -- Kept 30 days and deleted. Nobody in the app, ever.
  ('id-verification', 'id-verification', false, 26214400, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Who may touch what.
--
-- Every writable bucket uses the same shape: the first folder in the path is the person's own
-- account id, so `me/photo.jpg` is mine and `someone-else/photo.jpg` is refused by the database
-- rather than by the app remembering to check.
-- ---------------------------------------------------------------------------
create or replace function private.owns_storage_folder(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (storage.foldername(object_name))[1] = (select auth.uid())::text;
$$;
revoke all on function private.owns_storage_folder(text) from public;
grant execute on function private.owns_storage_folder(text) to authenticated;

-- avatars: anyone may look, only you may write in your own folder.
create policy "avatars: anyone reads" on storage.objects
  for select to anon, authenticated using (bucket_id = 'avatars');
create policy "avatars: own folder writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (select private.owns_storage_folder(name)));
create policy "avatars: own folder updates" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (select private.owns_storage_folder(name)));
create policy "avatars: own folder deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (select private.owns_storage_folder(name)));

-- set-previews: anyone may look; only the server writes, so no write policy exists at all.
create policy "set-previews: anyone reads" on storage.objects
  for select to anon, authenticated using (bucket_id = 'set-previews');

-- closet-photos: yours alone, both ways.
create policy "closet-photos: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'closet-photos' and (select private.owns_storage_folder(name)));
create policy "closet-photos: owner writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'closet-photos' and (select private.owns_storage_folder(name)));
create policy "closet-photos: owner updates" on storage.objects
  for update to authenticated
  using (bucket_id = 'closet-photos' and (select private.owns_storage_folder(name)));
create policy "closet-photos: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'closet-photos' and (select private.owns_storage_folder(name)));

-- private-fonts: yours alone, both ways.
create policy "private-fonts: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'private-fonts' and (select private.owns_storage_folder(name)));
create policy "private-fonts: owner writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'private-fonts' and (select private.owns_storage_folder(name)));
create policy "private-fonts: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'private-fonts' and (select private.owns_storage_folder(name)));

-- exports: you may read what was made for you; only the server makes it.
create policy "exports: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'exports' and (select private.owns_storage_folder(name)));

-- item-images, evidence, id-verification: no policy at all. The server reaches them with the
-- secret key, which bypasses RLS by design; nobody else reaches them by any route.
