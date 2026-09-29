-- Tests for migration 015 — clicks, and what a person may know about their own screening.
-- The ones that matter: a click can never name a person; nobody but the server writes one; and
-- the scan-state answer is one word about your own items and silence about everyone else's.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@test.kleit'),
  ('22222222-2222-4222-8222-222222222222', 'other@test.kleit');

insert into items (id, owner_id, kind, image_bucket, image_id, source_url) values
  ('dddddddd-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'a.jpg', null),
  ('dddddddd-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'b.jpg', null),
  ('dddddddd-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'own', 'closet-photos', 'c.jpg', null);
insert into item_flags (item_id, scan_state, scanned_at) values
  ('dddddddd-0000-4000-8000-000000000002', 'clean', now());

-- ---------------------------------------------------------------------------
-- clicks
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.clicks'::regclass),
  'clicks has RLS on');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'clicks'
      and (column_name ilike '%user%' or column_name ilike '%email%' or column_name ilike '%owner%')),
  0::bigint,
  'clicks has no column that could ever name a person');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok($$ insert into clicks (item_id) values ('dddddddd-0000-4000-8000-000000000001') $$,
  '42501', null, 'a signed-in person cannot write a click, not even for their own item');
select is((select count(*) from clicks), 0::bigint, 'a signed-in person who is not an admin sees no clicks');
reset role;
select set_config('request.jwt.claims', '', true);

set role anon;
select throws_ok($$ select * from clicks $$, '42501', null, 'a signed-out visitor cannot read clicks');
select throws_ok($$ insert into clicks (item_id) values ('dddddddd-0000-4000-8000-000000000001') $$,
  '42501', null, 'a signed-out visitor cannot write one');
reset role;

-- The server (no person) writes one and gets a random id back.
select set_config('request.jwt.claims', '', true);
select lives_ok($$ insert into clicks (item_id, network) values ('dddddddd-0000-4000-8000-000000000001', 'direct') $$,
  'the server can record a click');
select isnt((select click_id::text from clicks limit 1), null, 'the click has a random id');
select throws_ok($$ insert into clicks (item_id, network) values ('dddddddd-0000-4000-8000-000000000001', 'Not A Network!') $$,
  '23514', null, 'the network name is a short slug, nothing free-text can hide in it');

-- ---------------------------------------------------------------------------
-- my_items_scan_states
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select results_eq(
  $$ select item_id, scan_state from my_items_scan_states(array[
       'dddddddd-0000-4000-8000-000000000001',
       'dddddddd-0000-4000-8000-000000000002',
       'dddddddd-0000-4000-8000-000000000003']::uuid[]) order by item_id $$,
  $$ values ('dddddddd-0000-4000-8000-000000000001'::uuid, 'pending'),
            ('dddddddd-0000-4000-8000-000000000002'::uuid, 'clean') $$,
  'the owner gets one word per item of theirs - pending when unscanned - and nothing for anyone else''s');

select throws_ok($$ select * from item_flags $$, '42501', null,
  'and still cannot read item_flags itself');
reset role;
select set_config('request.jwt.claims', '', true);

set role anon;
select throws_ok($$ select * from my_items_scan_states(array['dddddddd-0000-4000-8000-000000000001']::uuid[]) $$,
  '42501', null, 'a signed-out visitor cannot ask at all');
reset role;

select is((select count(*) from pg_policies where tablename = 'clicks' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0::bigint, 'no person has any write policy on clicks');

select * from finish();
rollback;
