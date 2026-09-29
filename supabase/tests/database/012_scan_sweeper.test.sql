-- Tests for migration 014 — the scan sweeper (open problem CL25).
-- The ones that matter: a person cannot spend an item's tries or claim a batch; the batch holds
-- exactly the stragglers and nothing else; and claiming is something that happens once.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@test.kleit');

-- Six items, one per situation the sweeper has to tell apart. All with a picture.
insert into items (id, owner_id, kind, image_bucket, image_id, created_at) values
  -- a. old and never scanned -> due
  ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'a.jpg', now() - interval '10 minutes'),
  -- b. just uploaded -> NOT due: the app's own call is still running
  ('cccccccc-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'b.jpg', now() - interval '10 seconds'),
  -- c. old, already clean -> NOT due
  ('cccccccc-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'c.jpg', now() - interval '10 minutes'),
  -- d. old, pending, tried five times -> NOT due: give up, leave it for a person
  ('cccccccc-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'd.jpg', now() - interval '10 minutes'),
  -- e. old, pending, claimed a moment ago -> NOT due: somebody is on it
  ('cccccccc-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'e.jpg', now() - interval '10 minutes'),
  -- f. old, pending, claimed long ago and tried twice -> due again
  ('cccccccc-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'f.jpg', now() - interval '10 minutes'),
  -- g. old, never scanned, but deleted -> NOT due
  ('cccccccc-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'own', 'closet-photos', 'g.jpg', now() - interval '10 minutes');
update items set deleted_at = now() where id = 'cccccccc-0000-4000-8000-000000000007';

insert into item_flags (item_id, scan_state, attempts, scanned_at) values
  ('cccccccc-0000-4000-8000-000000000003', 'clean', 1, now()),
  ('cccccccc-0000-4000-8000-000000000004', 'pending', 5, null),
  ('cccccccc-0000-4000-8000-000000000005', 'pending', 1, null),
  ('cccccccc-0000-4000-8000-000000000006', 'pending', 2, null);
-- The touch trigger sets updated_at to now() on update, so set the "long ago" one directly.
alter table item_flags disable trigger item_flags_touch;
update item_flags set updated_at = now() - interval '20 minutes'
  where item_id = 'cccccccc-0000-4000-8000-000000000006';
alter table item_flags enable trigger item_flags_touch;

select is((select attempts from item_flags where item_id = 'cccccccc-0000-4000-8000-000000000003'), 1,
  'attempts is a real column with a default');

-- ---------------------------------------------------------------------------
-- A person may not touch either function.
-- ---------------------------------------------------------------------------
create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok($$ select claim_scans(10) $$, '42501', null,
  'a signed-in person cannot claim a batch of scans');
select throws_ok($$ select count_scan_attempt('cccccccc-0000-4000-8000-000000000001') $$, '42501', null,
  'a signed-in person cannot spend an item''s tries');
reset role;
select set_config('request.jwt.claims', '', true);

set role anon;
select throws_ok($$ select claim_scans(10) $$, '42501', null,
  'a signed-out visitor cannot claim a batch either');
reset role;

-- ---------------------------------------------------------------------------
-- The server claims exactly the stragglers.
-- ---------------------------------------------------------------------------
-- The tests run against the real test database, which has real stragglers of its own (the first
-- run of this file found one - a photo from 2026-09-28 whose scan never came back, which is the
-- exact thing the sweeper is for). So the batch is asked for at its largest and only the rows
-- this file created are counted; everything claimed here rolls back with the transaction.
create temp table first_batch as select * from claim_scans(50);

select results_eq(
  $$ select id from first_batch where id::text like 'cccccccc-%' order by id $$,
  $$ values ('cccccccc-0000-4000-8000-000000000001'::uuid), ('cccccccc-0000-4000-8000-000000000006'::uuid) $$,
  'the batch is the never-scanned old item and the one claimed long ago - nothing else');

select is((select image_bucket from first_batch where id = 'cccccccc-0000-4000-8000-000000000001'), 'closet-photos',
  'the batch says which bucket each picture is in');

select is((select attempts from item_flags where item_id = 'cccccccc-0000-4000-8000-000000000001'), 1,
  'claiming a never-scanned item creates its pending flag with one attempt');
select is((select scan_state::text from item_flags where item_id = 'cccccccc-0000-4000-8000-000000000001'), 'pending',
  'and the flag is pending, not anything kinder');
select is((select attempts from item_flags where item_id = 'cccccccc-0000-4000-8000-000000000006'), 3,
  'claiming a tried item counts one more attempt');
select is((select scan_state::text from item_flags where item_id = 'cccccccc-0000-4000-8000-000000000003'), 'clean',
  'the clean item was not touched');
select is((select attempts from item_flags where item_id = 'cccccccc-0000-4000-8000-000000000004'), 5,
  'the given-up item was not tried a sixth time');

-- Claiming is something that happens once.
select is((select count(*) from claim_scans(50)), 0::bigint,
  'a second sweep straight after the first finds nothing to do');

-- The app's own call counts itself.
select count_scan_attempt('cccccccc-0000-4000-8000-000000000002');
select is((select attempts from item_flags where item_id = 'cccccccc-0000-4000-8000-000000000002'), 1,
  'the app''s own call spends one try before it starts');

-- The timer exists, once.
select is((select count(*) from cron.job where jobname = 'sweep-images'), 1::bigint,
  'there is exactly one sweep timer');

select * from finish();
rollback;
