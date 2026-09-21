-- RLS tests for migration 001 — people (roadmap M1.4; technical pack §7 #1).
-- For each table: (a) the owner can read their own row, (b) a second account cannot,
-- (c) a signed-out visitor cannot, (d) RLS is on (000_rls_audit). A failure blocks the waypoint.
-- Everything runs inside a transaction and is rolled back: no test data is left behind.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(31);

-- Two fake accounts (technical pack §7.4 names). Never real people.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@test.kleit'),
  ('22222222-2222-4222-8222-222222222222', 'stranger@test.kleit');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', uid, true);
  end if;
end $$;
grant execute on function pg_temp.act_as(text) to anon, authenticated;

-- Server-side seed rows (as postgres, i.e. what an edge function with the secret key does)
insert into private_contact (user_id, phone_e164) values ('11111111-1111-4111-8111-111111111111', '+15555550123');
insert into user_devices (user_id, device_label) values ('11111111-1111-4111-8111-111111111111', 'iPhone');
insert into account_deletions (user_id) values ('11111111-1111-4111-8111-111111111111');
insert into age_confirmations (user_id_hash, terms_version) values ('hash-of-owner', '2026-09');
insert into blocked_identities (email_hash, reason) values ('hash-x', 'test');

-- ---------------- profiles ----------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select lives_ok($$ insert into profiles (user_id, username, age_confirmed_at, terms_version)
                   values ('11111111-1111-4111-8111-111111111111', 'owner.one', now(), '2026-09') $$,
  'profiles: the owner can create their own profile');
select throws_ok($$ insert into profiles (user_id, username, age_confirmed_at, terms_version)
                    values ('22222222-2222-4222-8222-222222222222', 'imposter', now(), '2026-09') $$,
  '42501', null, 'profiles: nobody can create a profile for someone else');

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select lives_ok($$ insert into profiles (user_id, username, age_confirmed_at, terms_version)
                   values ('22222222-2222-4222-8222-222222222222', 'stranger.two', now(), '2026-09') $$,
  'profiles: a second account creates its own profile');
select is((select count(*)::int from profiles where user_id = '11111111-1111-4111-8111-111111111111'), 1,
  'profiles: a signed-in stranger can read a public profile (permissions row 1)');
update profiles set bio = 'hacked' where user_id = '11111111-1111-4111-8111-111111111111';
reset role;
select is((select bio from profiles where user_id = '11111111-1111-4111-8111-111111111111'), '',
  'profiles: a second account cannot change someone else''s profile');

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok($$ update profiles set user_id = '22222222-2222-4222-8222-222222222222'
                    where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'profiles: the owner cannot hand their row to another account');
select throws_ok($$ delete from profiles where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'profiles: the app cannot delete a profile (server only, via account deletion)');
update profiles set deactivated_at = now() where user_id = '11111111-1111-4111-8111-111111111111';
select is((select count(*)::int from profiles where user_id = '11111111-1111-4111-8111-111111111111'), 1,
  'profiles: a deactivated owner still sees their own profile');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from profiles where user_id = '11111111-1111-4111-8111-111111111111'), 0,
  'profiles: a deactivated profile is hidden from everyone else (spec 3.6 #8)');
select pg_temp.act_as(null);
select throws_ok($$ select * from profiles $$, '42501', null,
  'profiles: a signed-out visitor cannot read profiles directly');

-- ---------------- username rules (spec 3.6 #5) ----------------
reset role;
update profiles set deactivated_at = null where user_id = '11111111-1111-4111-8111-111111111111';
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select lives_ok($$ update profiles set username = 'owner.two' where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'username: first change allowed');
select lives_ok($$ update profiles set username = 'owner.three' where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'username: second change allowed');
select throws_ok($$ update profiles set username = 'owner.four' where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'P0001', null, 'username: a third change inside 14 days is refused');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok($$ update profiles set username = 'owner.one' where user_id = '22222222-2222-4222-8222-222222222222' $$,
  'P0001', null, 'username: someone else''s old name is held for 14 days');
select is((select count(*)::int from username_history), 0,
  'username_history: a second account sees none of the owner''s history');
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from username_history), 2,
  'username_history: the owner sees their own history');
select throws_ok($$ insert into username_history (user_id, old_username)
                    values ('11111111-1111-4111-8111-111111111111', 'x.y.z') $$,
  '42501', null, 'username_history: the app cannot write history rows');

-- ---------------- private_contact ----------------
select is((select count(*)::int from private_contact), 1, 'private_contact: the owner reads their own row');
select throws_ok($$ insert into private_contact (user_id, phone_e164)
                    values ('11111111-1111-4111-8111-111111111111', '+15555550999') $$,
  '42501', null, 'private_contact: the app cannot write a phone number (server only, after Twilio)');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from private_contact), 0, 'private_contact: a second account sees nothing');
select pg_temp.act_as(null);
select throws_ok($$ select * from private_contact $$, '42501', null, 'private_contact: signed-out is refused');

-- ---------------- user_roles (security plan #5) ----------------
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select throws_ok($$ insert into user_roles (user_id, role) values ('22222222-2222-4222-8222-222222222222', 'admin') $$,
  '42501', null, 'user_roles: nobody can make themselves an admin');
select is((select count(*)::int from user_roles), 0, 'user_roles: a non-admin sees no roles');

-- ---------------- user_devices ----------------
select is((select count(*)::int from user_devices), 0, 'user_devices: a second account sees none of the owner''s devices');
delete from user_devices;
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is((select count(*)::int from user_devices), 1,
  'user_devices: a second account could not sign the owner out; the owner still sees their device');

-- ---------------- account_deletions ----------------
select is((select count(*)::int from account_deletions), 1, 'account_deletions: the owner sees their own request');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from account_deletions), 0, 'account_deletions: a second account sees nothing');

-- ---------------- server-only tables ----------------
select throws_ok($$ select * from age_confirmations $$, '42501', null,
  'age_confirmations: a signed-in user is refused (server only)');
select throws_ok($$ select * from blocked_identities $$, '42501', null,
  'blocked_identities: a signed-in user is refused (server only)');
select pg_temp.act_as(null);
select throws_ok($$ select * from age_confirmations $$, '42501', null,
  'age_confirmations: signed-out is refused');
select throws_ok($$ select * from blocked_identities $$, '42501', null,
  'blocked_identities: signed-out is refused');

reset role;
select * from finish();
rollback;
