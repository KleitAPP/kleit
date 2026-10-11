-- RLS tests for migration 002 — app_settings (roadmap M1.14). Rolled back; leaves nothing behind.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-333333333333', 'mod@test.kleit'),
  ('44444444-4444-4444-8444-444444444444', 'friend@test.kleit');
insert into user_roles (user_id, role) values ('33333333-3333-4333-8333-333333333333', 'admin');

select is((select count(*)::int from app_settings), 9, 'app_settings: the seven agreed keys exist (design pack G8), plus push_open (073) and beta_only (087)');

set local role anon;
select is((select value from app_settings where key = 'maintenance_mode'), 'false'::jsonb,
  'app_settings: a signed-out visitor can read the switches (the launch check runs before sign-in)');
select throws_ok($$ update app_settings set value = 'true' where key = 'maintenance_mode' $$, '42501', null,
  'app_settings: a signed-out visitor cannot change a switch');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
update app_settings set value = 'true' where key = 'maintenance_mode';
select is((select value from app_settings where key = 'maintenance_mode'), 'false'::jsonb,
  'app_settings: an ordinary account cannot change a switch');
select throws_ok($$ insert into app_settings (key, value) values ('signups_open', 'false') $$, '42501', null,
  'app_settings: an ordinary account cannot add a setting');

select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
update app_settings set value = '"1.2.0"' where key = 'min_app_version';
select is((select value from app_settings where key = 'min_app_version'), '"1.2.0"'::jsonb,
  'app_settings: an admin can change a switch');
select throws_ok($$ insert into app_settings (key, value) values ('free_money', 'true') $$, '23514', null,
  'app_settings: only the seven agreed keys can exist');

reset role;
select * from finish();
rollback;
