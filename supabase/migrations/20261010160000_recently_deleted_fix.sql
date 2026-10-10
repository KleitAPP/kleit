-- 075 · Recently deleted, one correction to 074: a set's Delete now goes through a function.
-- 074 added a delete policy on `sets`, but the table has had DELETE revoked from members since
-- 013 - belt and braces worth keeping, because it means the app can never run `delete from
-- sets` at all, whatever a policy says. The function checks the same two things the policy
-- did: the owner's own set, already in the bin. A new file because 074 is applied (L25).
drop policy if exists "sets: owner empties the bin" on public.sets;

create or replace function public.erase_set(p_set_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'signed out' using errcode = '42501'; end if;
  delete from public.sets where id = p_set_id and owner_id = me and deleted_at is not null;
  return found;
end $$;
revoke all on function public.erase_set(uuid) from public, anon;
grant execute on function public.erase_set(uuid) to authenticated;
