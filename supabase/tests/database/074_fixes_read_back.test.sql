-- Tests for migration 098: the share page's Buy matches the door; a stranger learns nothing
-- from tagging on somebody else's set; a tag remembers when its person was told; a table made
-- tomorrow lets no member truncate it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('f2f2f2f2-0000-4000-8000-000000000001', 'rb-owner@test.kleit'),
  ('f2f2f2f2-0000-4000-8000-000000000002', 'rb-friend@test.kleit'),
  ('f2f2f2f2-0000-4000-8000-000000000003', 'rb-stranger@test.kleit'),
  ('f2f2f2f2-0000-4000-8000-000000000004', 'rb-other@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, mention_setting) values
  ('f2f2f2f2-0000-4000-8000-000000000001', 'rbowner', now(), 't', 'everyone'),
  ('f2f2f2f2-0000-4000-8000-000000000002', 'rbfriend', now(), 't', 'everyone'),
  ('f2f2f2f2-0000-4000-8000-000000000003', 'rbstranger', now(), 't', 'everyone'),
  ('f2f2f2f2-0000-4000-8000-000000000004', 'rbother', now(), 't', 'following');
insert into follows (follower_id, followee_id) values ('f2f2f2f2-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000001');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('f2000000-0000-4000-8000-000000000001', 'f2f2f2f2-0000-4000-8000-000000000001', 'rb public', 'published', 'public', 'rbpublic00000001', now()),
  ('f2000000-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000001', 'rb followers', 'published', 'followers', 'rbfollowers00001', now());
-- Two store pieces on the public set: one cleared, one still being checked.
insert into items (id, owner_id, kind, title, source_url, source_domain) values
  ('f2000000-0000-4000-8000-000000000011', 'f2f2f2f2-0000-4000-8000-000000000001', 'product', 'rb cleared coat', 'https://shop.example.com/a', 'shop.example.com'),
  ('f2000000-0000-4000-8000-000000000012', 'f2f2f2f2-0000-4000-8000-000000000001', 'product', 'rb pending coat', 'https://shop.example.com/b', 'shop.example.com');
insert into item_flags (item_id, scan_state, scanned_at) values ('f2000000-0000-4000-8000-000000000011', 'clean', now());
insert into set_items (set_id, item_id, position) values
  ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000011', '{"slot": 0}'),
  ('f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000012', '{"slot": 1}');

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

-- 1. Buy on the share page only for a cleared piece - the same answer the door gives.
select is((select (p ->> 'buyable')::boolean from jsonb_array_elements(shared_set('rbpublic00000001') -> 'pieces') p where p ->> 'id' = 'f2000000-0000-4000-8000-000000000011'), true, 'share page: a cleared store piece is buyable');
select is((select (p ->> 'buyable')::boolean from jsonb_array_elements(shared_set('rbpublic00000001') -> 'pieces') p where p ->> 'id' = 'f2000000-0000-4000-8000-000000000012'), false, 'share page: one still being checked is not');

-- 2. A stranger tagging on somebody else's set is refused the same way whoever they name.
select pg_temp.act_as('f2f2f2f2-0000-4000-8000-000000000003');
select throws_ok($$ insert into set_tags (set_id, user_id, tagged_by) values ('f2000000-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000003') $$, '42501', null, 'stranger: naming a follower on a followers-only set is a plain refusal');
select throws_ok($$ insert into set_tags (set_id, user_id, tagged_by) values ('f2000000-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000004', 'f2f2f2f2-0000-4000-8000-000000000003') $$, '42501', null, 'stranger: naming a non-follower is the same refusal (no oracle)');

-- 3. told_at is the server's, stamped when the person is told.
select pg_temp.act_as('f2f2f2f2-0000-4000-8000-000000000001');
insert into set_tags (set_id, user_id, tagged_by, told_at) values ('f2000000-0000-4000-8000-000000000001', 'f2f2f2f2-0000-4000-8000-000000000002', 'f2f2f2f2-0000-4000-8000-000000000001', '2000-01-01');
select pg_temp.back();
select ok((select told_at > now() - interval '1 minute' from set_tags where set_id = 'f2000000-0000-4000-8000-000000000001' and user_id = 'f2f2f2f2-0000-4000-8000-000000000002'), 'a tag on a public set is told at once, and the stamp is now, not what the row carried');
select is((select count(*)::int from notifications where kind = 'tag' and user_id = 'f2f2f2f2-0000-4000-8000-000000000002'), 1, 'the friend is told once');
-- A second tag waits for its person's approval (they follow nobody); approving is theirs, the stamp is not.
select pg_temp.act_as('f2f2f2f2-0000-4000-8000-000000000001');
insert into set_tags (set_id, user_id, tagged_by) values ('f2000000-0000-4000-8000-000000000001', 'f2f2f2f2-0000-4000-8000-000000000004', 'f2f2f2f2-0000-4000-8000-000000000001');
select pg_temp.act_as('f2f2f2f2-0000-4000-8000-000000000004');
select throws_ok($$ update set_tags set state = 'approved', told_at = null where set_id = 'f2000000-0000-4000-8000-000000000001' and user_id = 'f2f2f2f2-0000-4000-8000-000000000004' $$, '42501', null, 'the tagged person cannot clear the stamp while approving');
select lives_ok($$ update set_tags set state = 'approved' where set_id = 'f2000000-0000-4000-8000-000000000001' and user_id = 'f2f2f2f2-0000-4000-8000-000000000004' $$, 'but approving on its own is theirs');
select pg_temp.act_as('f2f2f2f2-0000-4000-8000-000000000002');
delete from notifications where kind = 'tag' and user_id = 'f2f2f2f2-0000-4000-8000-000000000002';
select pg_temp.act_as('f2f2f2f2-0000-4000-8000-000000000001');
update sets set visibility = 'link' where id = 'f2000000-0000-4000-8000-000000000001';
update sets set visibility = 'public' where id = 'f2000000-0000-4000-8000-000000000001';
select pg_temp.back();
select is((select count(*)::int from notifications where kind = 'tag' and user_id = 'f2f2f2f2-0000-4000-8000-000000000002'), 0, 'a notification they cleared does not come back when the set is toggled');

-- 4. A table made after 095 lets no member truncate it either.
create table public.rb_probe_table (id int);
select ok(not has_table_privilege('authenticated', 'public.rb_probe_table', 'TRUNCATE') and not has_table_privilege('anon', 'public.rb_probe_table', 'TRUNCATE'), 'a new table grants no member truncate');
select ok(has_table_privilege('authenticated', 'public.rb_probe_table', 'SELECT'), 'the rest of the default grant is as it was');

select * from finish();
rollback;
