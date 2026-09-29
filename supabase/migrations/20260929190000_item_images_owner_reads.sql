-- Migration 016 — a person may look at the picture they clipped (roadmap M2.4; technical pack
-- §3.1).
--
-- `item-images` has had no read policy at all since migration 011: the server writes it, and
-- delivery to everyone else is Cloudflare Images off the stored original, at the domain stage.
-- But the person who clipped a picture is looking at "still checking" on their own drawer and
-- deserves to see what it is they are waiting on - and their own clip is theirs to see whether
-- it has passed screening or not, exactly as their own closet photo is (migration 010's owner
-- read). So: the owner reads their own folder, and nobody else reads anything. The first folder
-- in the path is the account id, which is what `private.owns_storage_folder` checks.
create policy "item-images: owner reads own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'item-images' and (select private.owns_storage_folder(name)));
