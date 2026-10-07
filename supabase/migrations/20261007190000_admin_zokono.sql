-- 070 · OW16 answered (2026-10-07, "zokono can be the admin"): the owner's account on kleit-test
-- gets the admin role, so the moderator screens, the switches and the weekly theme queue can be
-- used by a person. The TEST project only - the live project gets its own row at M10. Looked
-- up by username at apply time; if the name is not there (a fresh database), nothing happens
-- and nothing breaks.
insert into public.user_roles (user_id, role)
select p.user_id, 'admin'::public.staff_role from public.profiles p where p.username = 'zokono'
on conflict do nothing;
