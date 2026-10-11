-- Tests for migration 087 (S111, the invite-only beta): with `beta_only` on, finishing sign-up
-- needs a live code - missing (P0008) and wrong, spent, switched off or expired (P0009) are
-- refused and nothing is spent; a good one is spent once, with the profile; with the switch
-- off nothing changes. Minting and the list are the admins' alone.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(21);

insert into auth.users (id, email) values
  ('b1b1b1b1-0000-4000-8000-000000000001', 'bi-admin@test.kleit'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'bi-member@test.kleit'),
  ('b1b1b1b1-0000-4000-8000-000000000003', 'bi-new-a@test.kleit'),
  ('b1b1b1b1-0000-4000-8000-000000000004', 'bi-new-b@test.kleit'),
  ('b1b1b1b1-0000-4000-8000-000000000005', 'bi-new-c@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('b1b1b1b1-0000-4000-8000-000000000001', 'biadmin', now(), 't'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'bimember', now(), 't');
insert into user_roles (user_id, role) values ('b1b1b1b1-0000-4000-8000-000000000001', 'admin');
update app_settings set value = 'true' where key = 'beta_only';

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create temp table bi_codes (n integer primary key, code text);
grant all on bi_codes to authenticated;

-- Minting is the admins'.
select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000002');
select throws_ok($$ select mint_beta_invites('mine', 1, 1, 7) $$, '42501', null, 'member: cannot mint');
select is((select count(*)::int from admin_beta_invites()), 0, 'member: the list is empty');
select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000001');
insert into bi_codes select row_number() over (), c from mint_beta_invites('bi test (ignore)', 2, 1, 7) as c;
select is((select count(*)::int from bi_codes), 2, 'admin: two codes minted');
select is((select bool_and(code ~ '^[A-HJ-NP-Z2-9]{8}$') from bi_codes), true, 'codes are eight letters and digits that cannot be misread');

-- Newcomer A: the door needs a code; a wrong one is refused; the right one is spent once.
select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000003');
select is(check_beta_invite((select code from bi_codes where n = 1)), true, 'newcomer: a fresh code checks out');
select is(check_beta_invite('NOPE2345'), false, 'newcomer: a made-up code does not');
select throws_ok($$ select claim_profile('binewa', '', 'v0.1') $$, 'P0008', null, 'newcomer: no code - refused, told a code is needed');
select throws_ok($$ select claim_profile('binewa', '', 'v0.1', 'NOPE2345') $$, 'P0009', null, 'newcomer: a wrong code - refused');
select lives_ok($$ select claim_profile('binewa', '', 'v0.1', ' ' || lower((select code from bi_codes where n = 1)) || ' ') $$, 'newcomer: the right code, however typed - in');
select pg_temp.back();
select is((select count(*)::int from profiles where username = 'binewa'), 1, 'the profile exists');
select is((select count(*)::int from beta_invite_uses where user_id = 'b1b1b1b1-0000-4000-8000-000000000003' and code = (select code from bi_codes where n = 1)), 1, 'the use is on record');
select is((select uses_left from beta_invites where code = (select code from bi_codes where n = 1)), 0, 'the code is spent');
select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000004');
select is(check_beta_invite((select code from bi_codes where n = 1)), false, 'a spent code no longer checks out');
select throws_ok($$ select claim_profile('binewb', '', 'v0.1', (select code from bi_codes where n = 1)) $$, 'P0009', null, 'newcomer B: a spent code - refused');

-- Switched off; then a fresh one.
select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000001');
select is(disable_beta_invite((select code from bi_codes where n = 2)), true, 'admin: a code switched off');
insert into bi_codes select 3, c from mint_beta_invites('bi test again (ignore)', 1, 1, 0) as c;
select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000004');
select throws_ok($$ select claim_profile('binewb', '', 'v0.1', (select code from bi_codes where n = 2)) $$, 'P0009', null, 'newcomer B: a switched-off code - refused');
select lives_ok($$ select claim_profile('binewb', '', 'v0.1', (select code from bi_codes where n = 3)) $$, 'newcomer B: a fresh code with no expiry - in');

-- With the switch off, sign-up is as it always was.
select pg_temp.back();
update app_settings set value = 'false' where key = 'beta_only';
select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000005');
select lives_ok($$ select claim_profile('binewc', '', 'v0.1') $$, 'switch off: no code needed');

-- The list and the log.
select pg_temp.act_as('b1b1b1b1-0000-4000-8000-000000000001');
select is((select used_by from admin_beta_invites() where code = (select code from bi_codes where n = 1)), array['binewa'], 'admin: the list says who used a code');
select pg_temp.back();
select ok((select count(*) from admin_audit_log where admin_id = 'b1b1b1b1-0000-4000-8000-000000000001' and what = 'invite') >= 3, 'minting and switching off are in the audit log');
select throws_ok($$ select check_beta_invite('NOPE2345') $$, '42501', null, 'signed out: cannot probe codes');

select * from finish();
rollback;
