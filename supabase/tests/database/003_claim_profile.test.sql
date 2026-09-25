-- Tests for migration 003 — claiming a username (roadmap M1.7). Rolled back; leaves nothing behind.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('55555555-5555-4555-8555-555555555555', 'newbie@test.kleit'),
  ('66666666-6666-4666-8666-666666666666', 'other@test.kleit');

-- Act as a given signed-in account, the way PostgREST does.
create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
end $$;

-- ---- the availability check ----
select ok(username_available('jaywears'), 'username: a plain name is free');
select ok(not username_available('ab'), 'username: two letters is too short');
select ok(not username_available('Jay'), 'username: capitals are refused (usernames are lower case)');
select ok(not username_available('.jay'), 'username: cannot start with a dot');
select ok(not username_available('jay..wears'), 'username: no two punctuation marks in a row');
select ok(not username_available('admin'), 'username: reserved words are refused');
select ok(not username_available('kleit'), 'username: our own name is refused');

-- ---- claiming ----
select pg_temp.act_as('55555555-5555-4555-8555-555555555555');
select lives_ok($$ select claim_profile('jaywears', 'Jay', 'v0.1') $$, 'claim: a new account can take a free username');
select is((select username from profiles where user_id = '55555555-5555-4555-8555-555555555555'),
  'jaywears', 'claim: the profile row exists with that username');
-- Counted against THIS account's hash, not the whole table, so a real sign-up on kleit-test
-- can never make this test fail.
select is((select count(*)::int from age_confirmations
             where user_id_hash = encode(sha256('55555555-5555-4555-8555-555555555555'::text::bytea), 'hex')),
  1, 'claim: the 18+ record is filed at the same time (spec 3.7 #13)');
select is((select count(*)::int from age_confirmations
             where user_id_hash = '55555555-5555-4555-8555-555555555555'),
  0, 'claim: the 18+ record holds a hash, never the account id itself');
select ok(not username_available('jaywears'), 'claim: the name is taken afterwards');

select throws_ok($$ select claim_profile('somethingelse') $$, '23505', null,
  'claim: one account cannot make a second profile');

select pg_temp.act_as('66666666-6666-4666-8666-666666666666');
select throws_ok($$ select claim_profile('jaywears') $$, '23514', null,
  'claim: a second account cannot take a name already in use');

reset role;
select * from finish();
rollback;
