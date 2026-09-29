-- Migration 020 — the owner's own read must not depend on a function that cannot yet see the row.
--
-- 🔴 Found by making a Quick set on the live site: the insert was refused with "new row violates
-- row-level security policy". Not the insert itself - that passed - but the RETURNING that
-- follows it, which is checked against the SELECT policy. That policy asked can_view_set(), a
-- STABLE function, and a stable function sees the database as it was when the statement began:
-- a set that is being inserted in this very statement does not exist yet, so "can the owner see
-- it?" came back no. The tests never caught it because they inserted sets as postgres (L24).
--
-- The fix is the rule it always should have been: the owner sees their own row, full stop, and
-- the function decides for everyone else. Same for collections.
drop policy "sets: whoever can view" on public.sets;
create policy "sets: whoever can view" on public.sets for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.can_view_set(id, (select auth.uid()))));

drop policy "collections: owner or public" on public.collections;
create policy "collections: owner or public" on public.collections for select to authenticated
  using (owner_id = (select auth.uid()) or (select private.can_read_collection(id)));
