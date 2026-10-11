-- Tests for migration 079 (Remix, spec 7.4): a remix is a new draft of the remixer's with the
-- credit the server wrote and the pieces they may use; who may remix is the set's remix_mode,
-- never a blocked person; the credit cannot be claimed or changed by a member.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('ebebebeb-0000-4000-8000-000000000001', 'remix-owner@test.kleit'),
  ('ebebebeb-0000-4000-8000-000000000002', 'remix-stranger@test.kleit'),
  ('ebebebeb-0000-4000-8000-000000000003', 'remix-follower@test.kleit'),
  ('ebebebeb-0000-4000-8000-000000000004', 'remix-blocked@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('ebebebeb-0000-4000-8000-000000000001', 'remixowner', now(), 't'),
  ('ebebebeb-0000-4000-8000-000000000002', 'remixstranger', now(), 't'),
  ('ebebebeb-0000-4000-8000-000000000003', 'remixfollower', now(), 't'),
  ('ebebebeb-0000-4000-8000-000000000004', 'remixblocked', now(), 't');
insert into follows (follower_id, followee_id) values ('ebebebeb-0000-4000-8000-000000000003', 'ebebebeb-0000-4000-8000-000000000001');
insert into blocks (blocker_id, blocked_id) values ('ebebebeb-0000-4000-8000-000000000001', 'ebebebeb-0000-4000-8000-000000000004');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, layout) values
  ('eb000000-0000-4000-8000-000000000001', 'ebebebeb-0000-4000-8000-000000000001', 'the original', 'published', 'public', 'remixoriginal001', now(),
   '{"version": 2, "canvas": {"w": 1080, "h": 1350, "shape": "portrait"}, "caption": "mine", "texts": {"t1": {"kind": "text", "x": 1, "y": 1, "w": 10, "h": 10, "text": {"text": "hi", "font": "Inter"}}, "t2": {"kind": "text", "x": 1, "y": 1, "w": 10, "h": 10, "text": {"text": "secret font", "font": "private:abc"}}}}');
insert into items (id, owner_id, kind, title, image_bucket, image_id) values
  ('eb000000-0000-4000-8000-000000000011', 'ebebebeb-0000-4000-8000-000000000001', 'product', 'a coat', 'item-images', 'eb/coat.jpg'),
  ('eb000000-0000-4000-8000-000000000012', 'ebebebeb-0000-4000-8000-000000000001', 'own', 'my private jumper', 'closet-photos', 'ebebebeb-0000-4000-8000-000000000001/k.jpg');
insert into item_flags (item_id, scan_state, scanned_at) values
  ('eb000000-0000-4000-8000-000000000011', 'clean', now()), ('eb000000-0000-4000-8000-000000000012', 'clean', now());
insert into closet_items (user_id, item_id, shareable) values ('ebebebeb-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000012', false);
insert into set_items (set_id, item_id, position) values
  ('eb000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000011', '{"x": 10, "y": 10, "w": 300, "h": 300}'),
  ('eb000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000012', '{"x": 400, "y": 10, "w": 300, "h": 300}');

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

-- A stranger remixes a public set.
select pg_temp.act_as('ebebebeb-0000-4000-8000-000000000002');
create temp table r as select remix_set('eb000000-0000-4000-8000-000000000001') as j;
select is((select (j ->> 'copied')::int from r), 1, 'stranger: the cleared product came along');
select is((select (j ->> 'skipped')::int from r), 1, 'stranger: the owner''s private piece did not');
select ok((select (j ->> 'creative')::boolean from r), 'stranger: a Creative set stays a Creative set');
select is((select status::text from sets where id = (select (j ->> 'id')::uuid from r)), 'draft', 'the remix is a draft of the remixer''s');
select is((select owner_id from sets where id = (select (j ->> 'id')::uuid from r)), 'ebebebeb-0000-4000-8000-000000000002'::uuid, 'owned by the remixer');
select is((select remixed_from_label from sets where id = (select (j ->> 'id')::uuid from r)), 'Remixed from @remixowner', 'credited to the original');
select is((select layout ->> 'caption' from sets where id = (select (j ->> 'id')::uuid from r)), '', 'the caption is not copied');
select ok((select layout -> 'texts' ? 't1' and not (layout -> 'texts' ? 't2') from sets where id = (select (j ->> 'id')::uuid from r)), 'words in a public font come along; words in a private font do not');
select throws_ok($$ update sets set remixed_from_label = 'Remixed from @somebodyelse' where id = (select (j ->> 'id')::uuid from r) $$, 'P0001', null, 'the remixer cannot rewrite the credit');
select throws_ok($$ insert into sets (owner_id, title, status, remixed_from_label) values ('ebebebeb-0000-4000-8000-000000000002', 'fake', 'draft', 'Remixed from @remixowner') $$, '42501', null, 'nobody can claim a credit on a set of their own');
select pg_temp.back();
select is((select count(*)::int from notifications where user_id = 'ebebebeb-0000-4000-8000-000000000001' and kind = 'remix' and actor_id = 'ebebebeb-0000-4000-8000-000000000002'), 1, 'the owner is told');

-- Who may remix: the set's own mode, and never a blocked person.
update sets set remix_mode = 'followers' where id = 'eb000000-0000-4000-8000-000000000001';
select pg_temp.act_as('ebebebeb-0000-4000-8000-000000000002');
select throws_ok($$ select remix_set('eb000000-0000-4000-8000-000000000001') $$, 'P0001', null, 'followers only: a stranger is refused');
select pg_temp.act_as('ebebebeb-0000-4000-8000-000000000003');
select lives_ok($$ select remix_set('eb000000-0000-4000-8000-000000000001') $$, 'followers only: a follower may');
select pg_temp.act_as('ebebebeb-0000-4000-8000-000000000004');
select throws_ok($$ select remix_set('eb000000-0000-4000-8000-000000000001') $$, 'P0002', null, 'a blocked person gets not found, like everything else of the owner''s');

select * from finish();
rollback;
