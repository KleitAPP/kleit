-- 046 · Your own roles, so the app knows whether to show the review queue (M7.2). The
-- `user_roles` read policy is admins-only; this answers only for the caller.
create or replace function public.my_roles()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(r.role::text), '{}') from public.user_roles r where r.user_id = (select auth.uid());
$$;
revoke all on function public.my_roles() from public;
grant execute on function public.my_roles() to authenticated;
