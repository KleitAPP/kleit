-- Tests for migration 076 (CL53): an account made final leaves a row for the outside services
-- that still hold its id; only the server can read, claim or mark those rows.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('ecececec-0000-4000-8000-000000000001', 'forgotten@test.kleit'),
  ('ecececec-0000-4000-8000-000000000002', 'nosy@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('ecececec-0000-4000-8000-000000000001', 'forgotten', now(), 't'),
  ('ecececec-0000-4000-8000-000000000002', 'nosy', now(), 't');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The person asks; the seven days pass; the nightly job makes it final.
select pg_temp.act_as('ecececec-0000-4000-8000-000000000001');
select request_account_deletion();
reset role; select set_config('request.jwt.claims', '', true);
update account_deletions set final_at = now() - interval '1 minute' where user_id = 'ecececec-0000-4000-8000-000000000001';
select is((select private.finalize_account_deletions()), 1, 'nightly: the account is made final');
select is((select count(*)::int from auth.users where id = 'ecececec-0000-4000-8000-000000000001'), 0, 'the account is gone');
select is((select count(*)::int from external_cleanups where user_id = 'ecececec-0000-4000-8000-000000000001' and service = 'onesignal' and done_at is null), 1, 'a row says OneSignal must forget the id');

-- Only the server touches the rows.
select pg_temp.act_as('ecececec-0000-4000-8000-000000000002');
select throws_ok($$ select count(*) from external_cleanups $$, '42501', null, 'a member cannot read the list');
select throws_ok($$ select * from claim_cleanups(5) $$, '42501', null, 'a member cannot claim from it');
reset role; select set_config('request.jwt.claims', '', true);

-- Claiming counts a try; marking finishes it; a finished row is not handed out again.
select is((select count(*)::int from claim_cleanups(50) c where c.user_id = 'ecececec-0000-4000-8000-000000000001'), 1, 'server: claims the row');
select is((select attempts from external_cleanups where user_id = 'ecececec-0000-4000-8000-000000000001'), 1, 'server: the claim counted one try');
select mark_cleanup((select id from external_cleanups where user_id = 'ecececec-0000-4000-8000-000000000001'));
select is((select count(*)::int from claim_cleanups(50) c where c.user_id = 'ecececec-0000-4000-8000-000000000001'), 0, 'server: a finished row leaves the list');

select * from finish();
rollback;
