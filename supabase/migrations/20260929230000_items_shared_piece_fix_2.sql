-- Migration 019 — the same policy, one more subquery that ran under the wrong person's rules.
--
-- 🔴 Found by the grid tests again: the policy asked `closet_items` whether the piece is
-- shareable, and that table is owner-only, so for anyone but the owner the question came back
-- "no such row" and the piece stayed hidden. Same shape as migration 018 (L25): a policy's
-- subquery runs as the viewer, so a fact that lives in a private table has to be fetched by a
-- function that reads as its owner.
create or replace function private.closet_says_shareable(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.closet_items ci
    where ci.item_id = p_item_id and ci.shareable and ci.deleted_at is null
  );
$$;
revoke all on function private.closet_says_shareable(uuid) from public;
grant execute on function private.closet_says_shareable(uuid) to authenticated;

drop policy "items: viewers of a set read shareable own pieces" on public.items;
create policy "items: viewers of a set read shareable own pieces" on public.items
  for select to authenticated
  using (
    kind = 'own'
    and deleted_at is null
    and takedown_state = 'none'
    and (select private.image_cleared(id))
    and (select private.closet_says_shareable(id))
    and (select private.on_a_viewable_set(id, (select auth.uid())))
  );
