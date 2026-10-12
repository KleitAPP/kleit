-- Tests for migration 093: "Sets with this item" lists public published sets only - never a
-- followers-only one (even to a follower), a deleted one, or one across a block - and agrees
-- with the count the view has given since 017.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

insert into auth.users (id, email) values
  ('b4b4b4b4-0000-4000-8000-000000000001', 'swi-a@test.kleit'),
  ('b4b4b4b4-0000-4000-8000-000000000002', 'swi-b@test.kleit'),
  ('b4b4b4b4-0000-4000-8000-000000000003', 'swi-c@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('b4b4b4b4-0000-4000-8000-000000000001', 'swia', now(), 't'),
  ('b4b4b4b4-0000-4000-8000-000000000002', 'swib', now(), 't'),
  ('b4b4b4b4-0000-4000-8000-000000000003', 'swic', now(), 't');
-- b follows a (so a followers-only set of a's is visible to b, yet must not be listed).
insert into follows (follower_id, followee_id) values ('b4b4b4b4-0000-4000-8000-000000000002', 'b4b4b4b4-0000-4000-8000-000000000001');
insert into items (id, owner_id, kind, title, price_cents, price_currency, source_url, source_domain) values
  ('b4000000-0000-4000-8000-000000000001', 'b4b4b4b4-0000-4000-8000-000000000001', 'product', 'swi coat', 5000, 'USD', 'https://example.com/swi', 'example.com');
insert into item_flags (item_id, scan_state) values ('b4000000-0000-4000-8000-000000000001', 'clean');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, deleted_at) values
  ('b4000000-0000-4000-8000-000000000011', 'b4b4b4b4-0000-4000-8000-000000000001', 'swi public', 'published', 'public', 'swipublic0000001', now() - interval '2 days', null),
  ('b4000000-0000-4000-8000-000000000012', 'b4b4b4b4-0000-4000-8000-000000000001', 'swi followers', 'published', 'followers', 'swifollow0000002', now() - interval '1 day', null),
  ('b4000000-0000-4000-8000-000000000013', 'b4b4b4b4-0000-4000-8000-000000000001', 'swi deleted', 'published', 'public', 'swideleted000003', now(), now()),
  ('b4000000-0000-4000-8000-000000000014', 'b4b4b4b4-0000-4000-8000-000000000003', 'swi by c', 'published', 'public', 'swibyc0000000004', now() - interval '3 days', null);
insert into set_items (set_id, item_id, position) values
  ('b4000000-0000-4000-8000-000000000011', 'b4000000-0000-4000-8000-000000000001', '{"slot": 0}'),
  ('b4000000-0000-4000-8000-000000000012', 'b4000000-0000-4000-8000-000000000001', '{"slot": 0}'),
  ('b4000000-0000-4000-8000-000000000013', 'b4000000-0000-4000-8000-000000000001', '{"slot": 0}'),
  ('b4000000-0000-4000-8000-000000000014', 'b4000000-0000-4000-8000-000000000001', '{"slot": 0}');
-- b has blocked c.
insert into blocks (blocker_id, blocked_id) values ('b4b4b4b4-0000-4000-8000-000000000002', 'b4b4b4b4-0000-4000-8000-000000000003');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('b4b4b4b4-0000-4000-8000-000000000002');
select is((select count(*)::int from sets_with_item('b4000000-0000-4000-8000-000000000001')), 1, 'b: one set - the public one by a (not the followers-only one b may see, not the deleted one, not the one by the person b blocked)');
select is((select id from sets_with_item('b4000000-0000-4000-8000-000000000001')), 'b4000000-0000-4000-8000-000000000011'::uuid, 'b: and it is the public one');
select is((select set_count from public_item_stats where item_id = 'b4000000-0000-4000-8000-000000000001'), 2, 'the count the view gives is the public sets, blocks aside');
select pg_temp.act_as('b4b4b4b4-0000-4000-8000-000000000001');
select is((select count(*)::int from sets_with_item('b4000000-0000-4000-8000-000000000001')), 2, 'a (the owner of most): the two public ones - never their own followers-only or deleted one');
select is((select id from sets_with_item('b4000000-0000-4000-8000-000000000001', 1)), 'b4000000-0000-4000-8000-000000000011'::uuid, 'newest first, and the limit holds');
select pg_temp.act_as('b4b4b4b4-0000-4000-8000-000000000003');
select is((select count(*)::int from sets_with_item('b4000000-0000-4000-8000-000000000001')), 2, 'c (blocked by b, not by a): a''s public one and their own');

select * from finish();
rollback;
