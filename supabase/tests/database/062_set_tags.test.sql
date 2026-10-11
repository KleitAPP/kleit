-- Tests for migration 082 (tags in a set, spec 7.4): the owner tags; a tag from someone the
-- person follows shows at once and any other waits for them; "No one" refuses; blocked never;
-- the tagged person approves or removes themselves; viewers see approved tags only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('aeaeaeae-0000-4000-8000-000000000001', 't-owner@test.kleit'),
  ('aeaeaeae-0000-4000-8000-000000000002', 't-friend@test.kleit'),
  ('aeaeaeae-0000-4000-8000-000000000003', 't-stranger@test.kleit'),
  ('aeaeaeae-0000-4000-8000-000000000004', 't-open@test.kleit'),
  ('aeaeaeae-0000-4000-8000-000000000005', 't-closed@test.kleit'),
  ('aeaeaeae-0000-4000-8000-000000000006', 't-blocker@test.kleit'),
  ('aeaeaeae-0000-4000-8000-000000000007', 't-viewer@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, mention_setting) values
  ('aeaeaeae-0000-4000-8000-000000000001', 'towner', now(), 't', 'following'),
  ('aeaeaeae-0000-4000-8000-000000000002', 'tfriend', now(), 't', 'following'),
  ('aeaeaeae-0000-4000-8000-000000000003', 'tstranger', now(), 't', 'following'),
  ('aeaeaeae-0000-4000-8000-000000000004', 'topen', now(), 't', 'everyone'),
  ('aeaeaeae-0000-4000-8000-000000000005', 'tclosed', now(), 't', 'nobody'),
  ('aeaeaeae-0000-4000-8000-000000000006', 'tblocker', now(), 't', 'everyone'),
  ('aeaeaeae-0000-4000-8000-000000000007', 'tviewer', now(), 't', 'following');
insert into follows (follower_id, followee_id) values ('aeaeaeae-0000-4000-8000-000000000002', 'aeaeaeae-0000-4000-8000-000000000001');
insert into blocks (blocker_id, blocked_id) values ('aeaeaeae-0000-4000-8000-000000000006', 'aeaeaeae-0000-4000-8000-000000000001');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ae000000-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000001', 'tagged set', 'published', 'public', 'tagsetpublic0001', now());

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

-- The owner tags.
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000001');
insert into set_tags (set_id, user_id, tagged_by) values
  ('ae000000-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000002', 'aeaeaeae-0000-4000-8000-000000000001'),
  ('ae000000-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000003', 'aeaeaeae-0000-4000-8000-000000000001'),
  ('ae000000-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000004', 'aeaeaeae-0000-4000-8000-000000000001');
select is((select state from set_tags where user_id = 'aeaeaeae-0000-4000-8000-000000000002'), 'approved', 'a friend who follows the owner: shown at once');
select is((select state from set_tags where user_id = 'aeaeaeae-0000-4000-8000-000000000003'), 'pending', 'a stranger: waits for their approval');
select is((select state from set_tags where user_id = 'aeaeaeae-0000-4000-8000-000000000004'), 'approved', '"everyone": shown at once');
select throws_ok($$ insert into set_tags (set_id, user_id, tagged_by) values ('ae000000-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000005', 'aeaeaeae-0000-4000-8000-000000000001') $$, '42501', null, '"no one": refused');
select throws_ok($$ insert into set_tags (set_id, user_id, tagged_by) values ('ae000000-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000006', 'aeaeaeae-0000-4000-8000-000000000001') $$, '42501', null, 'a blocked pair: refused');
select pg_temp.back();
select is((select count(*)::int from notifications where kind = 'tag' and ref_id = 'ae000000-0000-4000-8000-000000000001'), 3, 'each tagged person is told');

-- The stranger approves; the friend removes themselves; a viewer sees approved tags only.
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000007');
select is((select count(*)::int from set_people('ae000000-0000-4000-8000-000000000001')), 2, 'viewer: sees the two approved tags, not the pending one');
select throws_ok($$ insert into set_tags (set_id, user_id, tagged_by) values ('ae000000-0000-4000-8000-000000000001', 'aeaeaeae-0000-4000-8000-000000000007', 'aeaeaeae-0000-4000-8000-000000000007') $$, '42501', null, 'viewer: cannot tag on someone else''s set');
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000003');
update set_tags set state = 'approved' where set_id = 'ae000000-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000003';
select pg_temp.back();
select is((select state from set_tags where user_id = 'aeaeaeae-0000-4000-8000-000000000003'), 'approved', 'the stranger approved their own tag');
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000002');
delete from set_tags where set_id = 'ae000000-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000002';
delete from set_tags where set_id = 'ae000000-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000004';
select pg_temp.back();
select is((select count(*)::int from set_tags where user_id = 'aeaeaeae-0000-4000-8000-000000000002'), 0, 'the friend removed themselves');
select is((select count(*)::int from set_tags where user_id = 'aeaeaeae-0000-4000-8000-000000000004'), 1, 'but could not remove anyone else');
select pg_temp.act_as('aeaeaeae-0000-4000-8000-000000000001');
delete from set_tags where set_id = 'ae000000-0000-4000-8000-000000000001' and user_id = 'aeaeaeae-0000-4000-8000-000000000004';
select pg_temp.back();
select is((select count(*)::int from set_tags where user_id = 'aeaeaeae-0000-4000-8000-000000000004'), 0, 'the owner can take a tag off');
select throws_ok($$ update set_tags set user_id = 'aeaeaeae-0000-4000-8000-000000000007' where user_id = 'aeaeaeae-0000-4000-8000-000000000003' $$, '42501', null, 'server: a tag is never moved to another person');

select * from finish();
rollback;
