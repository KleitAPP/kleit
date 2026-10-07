-- Tests for migration 057: which stored pictures the purge job may delete, and that nobody but
-- the server can say a picture was purged.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values ('e5e5e5e5-0000-4000-8000-000000000001', 'purge-owner@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e5e5e5e5-0000-4000-8000-000000000001', 'purgeowner', now(), 't');
insert into items (id, owner_id, kind, title, image_id, image_bucket, takedown_state, deleted_at) values
  ('e5000000-0000-4000-8000-000000000001', 'e5e5e5e5-0000-4000-8000-000000000001', 'own', 'live', 'e5/live.jpg', 'closet-photos', 'none', null),
  ('e5000000-0000-4000-8000-000000000002', 'e5e5e5e5-0000-4000-8000-000000000001', 'own', 'taken down', 'e5/down.jpg', 'closet-photos', 'removed', null),
  ('e5000000-0000-4000-8000-000000000003', 'e5e5e5e5-0000-4000-8000-000000000001', 'own', 'deleted yesterday', 'e5/fresh.jpg', 'closet-photos', 'none', now() - interval '1 day'),
  ('e5000000-0000-4000-8000-000000000004', 'e5e5e5e5-0000-4000-8000-000000000001', 'own', 'deleted long ago', 'e5/old.jpg', 'closet-photos', 'none', now() - interval '40 days'),
  ('e5000000-0000-4000-8000-000000000005', 'e5e5e5e5-0000-4000-8000-000000000001', 'own', 'no picture', null, 'closet-photos', 'removed', null);

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The list, as the server.
select is((select count(*)::int from claim_purges() where id::text like 'e5000000-%'), 2, 'server: the taken-down picture and the 40-day-old deletion are due; the live one, the fresh deletion and the row with no picture are not');
select ok((select keep_evidence from claim_purges() where id = 'e5000000-0000-4000-8000-000000000002'), 'server: the taken-down picture is kept as evidence first');
select ok(not (select keep_evidence from claim_purges() where id = 'e5000000-0000-4000-8000-000000000004'), 'server: an ordinary deletion keeps no evidence');
-- Ordering among the test's own rows only: the live project may hold other due pictures.
select is((select x.id from (select id, row_number() over () as rn from claim_purges(100)) x where x.id::text like 'e5000000-%' order by x.rn limit 1), 'e5000000-0000-4000-8000-000000000002'::uuid, 'server: the taken-down picture comes before the old deletion');

-- Marking, and the guard.
select lives_ok($$ select mark_purged('e5000000-0000-4000-8000-000000000002') $$, 'server: marks the picture purged');
select is((select count(*)::int from claim_purges() where id::text like 'e5000000-%'), 1, 'server: a purged picture leaves the list');
select pg_temp.act_as('e5e5e5e5-0000-4000-8000-000000000001');
select throws_ok($$ select * from claim_purges() $$, '42501', null, 'owner: cannot call the purge list');
select throws_ok($$ update items set purged_at = null where id = 'e5000000-0000-4000-8000-000000000002' $$, '42501', null, 'owner: cannot clear purged_at (nor set it)');

select * from finish();
rollback;
