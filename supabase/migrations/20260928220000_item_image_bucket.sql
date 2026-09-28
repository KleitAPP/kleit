-- Migration 012 — which bucket an item's picture lives in (roadmap M2.6; technical pack §3.1).
--
-- Why this exists: an item row said WHICH FILE its picture was and not WHICH BUCKET, because until
-- now every picture came from the same place - our own copy of something clipped from a shop. A
-- photo somebody takes of their own jumper does not belong there. By the technical pack it belongs
-- in `closet-photos`, which is private to its owner, and the screening function has to know which
-- of the two to read.
--
-- 🔴 The check constraint is not tidiness, it is the point. Without it a client could create an
-- item claiming its picture lives in `evidence` or `id-verification` - the two buckets nobody in
-- the app may touch - and `ingest-image`, which runs as the server and bypasses every row policy,
-- would dutifully read it and, if it found metadata in it, OVERWRITE it. A column that names a
-- bucket is a column that can name the wrong one, so it may only ever hold these two.
create type public.image_bucket as enum ('item-images', 'closet-photos');

alter table public.items
  add column image_bucket public.image_bucket not null default 'item-images';

comment on column public.items.image_bucket is
  'Which storage bucket image_id lives in. Only the two picture buckets are possible, by type: the
   server-only buckets (evidence, id-verification) must never be nameable from a row a person can
   write.';

-- The owner may set it when they create the row, and may never move a picture afterwards - the
-- same protection source_url already has, and for the same reason: where a stored image came from
-- is a record, not a preference.
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
     or new.owner_id is distinct from old.owner_id
     or new.image_bucket is distinct from old.image_bucket then
    raise exception 'source_url, image_hash, takedown_state, owner_id and image_bucket are set by the server only';
  end if;
  return new;
end;
$$;
