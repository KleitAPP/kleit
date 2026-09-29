-- Migration 018 — the shareable-own-piece read must not ask set_items through its own policies.
--
-- 🔴 Found by the visibility tests on the first run of migration 017: the items policy "viewers
-- of a set read shareable own pieces" queried `set_items`, whose insert policy queries `items`
-- (may this person see the piece they are placing?), which queried `set_items`... Postgres
-- refused with "infinite recursion detected in policy". The rule was right; the route was wrong.
--
-- The question "is this piece on a set the viewer may see?" is now answered by a function that
-- reads set_items as its owner - no policies in the way - and asks can_view_set for each set.
-- Migration 017 stays as it ran (lesson L25); this replaces the one policy.
create or replace function private.on_a_viewable_set(p_item_id uuid, p_viewer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.set_items si
    where si.item_id = p_item_id and (select public.can_view_set(si.set_id, p_viewer))
  );
$$;
revoke all on function private.on_a_viewable_set(uuid, uuid) from public;
grant execute on function private.on_a_viewable_set(uuid, uuid) to authenticated;

drop policy "items: viewers of a set read shareable own pieces" on public.items;
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
    and (select private.on_a_viewable_set(id, (select auth.uid())))
  );
