-- Tests for migration 108 (spec 10.5 #2, #4; CL69): impersonation and trademark claims are
-- takedown rows; at most two ID photos; the photos come due for purging thirty days after the
-- claim and not before; marking purged empties the paths; a moderator resolves a claim with no
-- picture to remove; the sender's status check knows the new kinds.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values ('c9c9c9c9-0000-4000-8000-000000000003', 'cl-moderator@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('c9c9c9c9-0000-4000-8000-000000000003', 'clmoderator', now(), 't');
insert into user_roles (user_id, role) values ('c9c9c9c9-0000-4000-8000-000000000003', 'moderator');

select lives_ok($$insert into takedown_requests (id, request_ref, kind, name, email, urls, details, id_paths) values
  ('c9000000-0000-4000-8000-000000000001', 'T-CLAIMONE', 'impersonation', 'B. Brand', 'legal@brand.example', '{https://kleit-test.example/u/notbrand}', 'that account uses our name and logo', '{T-CLAIMONE/1.jpg,T-CLAIMONE/2.jpg}')$$,
  'an impersonation claim with two ID photos');
select throws_ok($$insert into takedown_requests (request_ref, kind, name, email, urls, id_paths) values
  ('T-CLAIMTWO', 'impersonation', 'B. Brand', 'legal@brand.example', '{https://kleit-test.example/u/notbrand}', '{a,b,c}')$$,
  '23514', null, 'three photos are refused');
select lives_ok($$insert into takedown_requests (id, request_ref, kind, name, email, urls, work, statements, signature) values
  ('c9000000-0000-4000-8000-000000000002', 'T-CLAIMTM', 'trademark', 'B. Brand', 'legal@brand.example', '{https://kleit-test.example/s/abcdefghijklmnop}', 'BRAND, US reg. 1234567', true, 'B. Brand')$$,
  'a trademark claim with the mark, the statements and a signature');
select throws_ok($$insert into takedown_requests (request_ref, kind, name, email, urls) values
  ('T-CLAIMBAD', 'parody', 'X', 'x@example.com', '{https://kleit-test.example/s/abcdefghijklmnop}')$$,
  '23514', null, 'an unknown kind is refused');

-- The photos are not due yet; thirty-one days on, they are; marking empties the paths.
select is((select count(*)::int from claim_id_purges(20)), 0, 'a fresh claim''s photos are not due');
update takedown_requests set created_at = now() - interval '31 days' where id = 'c9000000-0000-4000-8000-000000000001';
select is((select count(*)::int from claim_id_purges(20)), 1, 'thirty-one days on, the photos are due');
select mark_id_purged('c9000000-0000-4000-8000-000000000001');
select is((select id_paths from takedown_requests where id = 'c9000000-0000-4000-8000-000000000001'), '{}'::text[], 'marking purged forgets the paths');

-- A moderator resolves a trademark claim with nothing to remove; the status check reads it.
create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
select pg_temp.act_as('c9c9c9c9-0000-4000-8000-000000000003');
select is(takedown_resolve('c9000000-0000-4000-8000-000000000002', 'removed', 'label applied; name released'), 0, 'moderator: a claim resolves with no picture removed');
select is((select state from takedown_status('t-claimtm')), 'removed', 'the sender''s status check reads the outcome by reference');

select * from finish();
rollback;
