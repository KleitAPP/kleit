-- 074 · Recently deleted (spec 7.1 #7, #9, #11; design pack S26). A deleted set or closet piece
-- sits in a bin for 30 days with Restore and Delete now; only its owner ever sees the bin.
--
-- Sets already had the timestamp (`sets.deleted_at`, 013) and the nightly sweep (049). What was
-- missing: a way for the owner to empty the bin themselves. Closet pieces had the column too
-- (design-pack G3) and nothing that wrote it. Four server functions do the closet's part, so
-- the two rows a piece lives in (`closet_items`, `items`) always change together.
--
-- What "delete" means for a piece, in one place:
--   · Out of the closet = `closet_items.deleted_at`. The closet screen stops showing it.
--   · "Remove it from my sets too" = the set_items rows on the owner's own sets go, and the
--     item row is marked deleted - hidden from everyone at once (the viewer policies all ask for
--     `deleted_at is null`), its picture wiped by the nightly purge 30 days later (057).
--   · "Keep it in my sets" = only the closet row changes. The sets look exactly as they did, to
--     everyone - which is why `closet_says_shareable` no longer asks whether the closet row is
--     deleted: leaving the closet is not a sharing decision (the `shareable` flag still is).
--   · Restore = the closet row comes back, and the item row's deleted mark goes if it was set.
--     Only inside the 30 days and only while the picture file still exists.
--   · Delete now = gone from the bin, from the owner's sets, and from everyone's view. The file
--     follows with the purge. The item row stays (a stored file with no row is the orphan
--     decision 103 forbids; the row with no file is the record that there was one).

-- ---------------------------------------------------------------------------
-- 1. Sets: the owner may destroy a set that is already in the bin, and only then. The cascades
--    (pieces, versions, comments, likes, poll options, entries) are the same ones the nightly
--    sweep relies on.
-- ---------------------------------------------------------------------------
create policy "sets: owner empties the bin" on public.sets for delete to authenticated
  using (owner_id = (select auth.uid()) and deleted_at is not null);

-- ---------------------------------------------------------------------------
-- 2. Closet pieces.
-- ---------------------------------------------------------------------------
-- How many of your own sets (not in the bin) hold this piece: the "used in 12 sets" warning.
create or replace function public.closet_item_uses(p_item_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(distinct si.set_id)::int
  from public.set_items si join public.sets s on s.id = si.set_id
  where si.item_id = p_item_id and s.owner_id = (select auth.uid()) and s.deleted_at is null;
$$;
revoke all on function public.closet_item_uses(uuid) from public, anon;
grant execute on function public.closet_item_uses(uuid) to authenticated;

-- Out of the closet, into the bin. Returns how many sets it was taken off.
create or replace function public.delete_closet_item(p_item_id uuid, p_keep_in_sets boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); n integer := 0;
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  update public.closet_items set deleted_at = now()
   where user_id = me and item_id = p_item_id and deleted_at is null;
  if not found then raise exception 'not in your closet' using errcode = 'P0002'; end if;
  if not p_keep_in_sets then
    delete from public.set_items si using public.sets s
     where s.id = si.set_id and si.item_id = p_item_id and s.owner_id = me;
    get diagnostics n = row_count;
    update public.items set deleted_at = now() where id = p_item_id and owner_id = me and deleted_at is null;
  end if;
  return n;
end $$;
revoke all on function public.delete_closet_item(uuid, boolean) from public, anon;
grant execute on function public.delete_closet_item(uuid, boolean) to authenticated;

-- Back into the closet: inside the 30 days, while the picture is still there and not taken down.
create or replace function public.restore_closet_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.closet_items ci join public.items i on i.id = ci.item_id
    where ci.user_id = me and ci.item_id = p_item_id
      and ci.deleted_at is not null and ci.deleted_at > now() - interval '30 days'
      and i.purged_at is null and i.takedown_state = 'none'
  ) then
    raise exception 'gone' using errcode = 'P0002';
  end if;
  update public.closet_items set deleted_at = null where user_id = me and item_id = p_item_id;
  update public.items set deleted_at = null where id = p_item_id and owner_id = me and deleted_at is not null;
end $$;
revoke all on function public.restore_closet_item(uuid) from public, anon;
grant execute on function public.restore_closet_item(uuid) to authenticated;

-- Delete now: off the owner's sets, hidden from everyone, out of the bin. The purge takes the file.
create or replace function public.erase_closet_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  if not exists (select 1 from public.closet_items where user_id = me and item_id = p_item_id and deleted_at is not null) then
    raise exception 'not in the bin' using errcode = 'P0002';
  end if;
  delete from public.set_items si using public.sets s
   where s.id = si.set_id and si.item_id = p_item_id and s.owner_id = me;
  update public.items set deleted_at = now() where id = p_item_id and owner_id = me and deleted_at is null;
  delete from public.closet_items where user_id = me and item_id = p_item_id;
end $$;
revoke all on function public.erase_closet_item(uuid) from public, anon;
grant execute on function public.erase_closet_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Leaving the closet is not a sharing decision. The flag speaks for the piece whether or
--    not the row is in the bin; a piece removed from the sets too is hidden by its own
--    `items.deleted_at`, which every viewer policy already checks.
-- ---------------------------------------------------------------------------
create or replace function private.closet_says_shareable(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.closet_items ci where ci.item_id = p_item_id and ci.shareable);
$$;
