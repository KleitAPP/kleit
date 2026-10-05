-- Tests for user-made templates (migration 017 row 18; roadmap M4.5 "Done when": a user
-- builds a template, publishes it, and a second account fills it with their own items -
-- here the database half: a published template is readable by a second account, a private
-- one is not, and nobody edits anyone else's).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001', 'tplmaker@test.kleit'),
  ('dddddddd-0000-4000-8000-000000000002', 'tpluser@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('dddddddd-0000-4000-8000-000000000001', 'tplmaker', now(), 't'),
  ('dddddddd-0000-4000-8000-000000000002', 'tpluser', now(), 't');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The maker builds two: one private, one published.
select pg_temp.act_as('dddddddd-0000-4000-8000-000000000001');
insert into templates (id, owner_id, name, kind, is_public, layout) values
  ('97979797-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'Private one', 'slot', false,
   '{"version":2,"canvas":{"w":1080,"h":1350,"shape":"portrait"},"background":"#F4EFE6","slots":[{"x":0.1,"y":0.1,"w":0.5,"h":0.5}],"order":["slot-1"]}'),
  ('97979797-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001', 'Published one', 'stacked', true,
   '{"version":2,"canvas":{"w":1080,"h":1350,"shape":"portrait"},"background":"#F4EFE6","slots":[{"x":0.1,"y":0.1,"w":0.5,"h":0.5},{"x":0.3,"y":0.3,"w":0.5,"h":0.5}],"order":["slot-1","slot-2"]}');
select is((select count(*)::int from templates where owner_id = 'dddddddd-0000-4000-8000-000000000001'), 2, 'maker: sees both of their templates');
select throws_ok($$ insert into templates (owner_id, name, kind, is_public, layout) values ('dddddddd-0000-4000-8000-000000000002', 'forged', 'slot', true, '{}') $$,
  '42501', null, 'maker: cannot make a template in someone else''s name');

-- The second account: Kleit's four, the published one, never the private one.
select pg_temp.act_as('dddddddd-0000-4000-8000-000000000002');
select is((select count(*)::int from templates where id = '97979797-0000-4000-8000-000000000002'), 1, 'user: the published template is readable');
select is((select count(*)::int from templates where id = '97979797-0000-4000-8000-000000000001'), 0, 'user: the private one is invisible');
select is((select count(*)::int from templates where owner_id is null), 4, 'user: Kleit''s four are there too');
update templates set name = 'vandalised' where id = '97979797-0000-4000-8000-000000000002';
select is((select name from templates where id = '97979797-0000-4000-8000-000000000002'), 'Published one', 'user: cannot rename someone else''s published template');
delete from templates where id = '97979797-0000-4000-8000-000000000002';
select is((select count(*)::int from templates where id = '97979797-0000-4000-8000-000000000002'), 1, 'user: cannot delete it either');

-- Filling it: a set on the published template, owned by the second account.
insert into sets (id, owner_id, title, status, visibility, share_code, layout) values
  ('96969696-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000002', 'filled', 'draft', 'only_me', 'tplfill000000001',
   '{"version":1,"template":"97979797-0000-4000-8000-000000000002","background":"#F4EFE6","caption":""}');
select is((select layout->>'template' from sets where id = '96969696-0000-4000-8000-000000000001'), '97979797-0000-4000-8000-000000000002', 'user: a set made on the published template is theirs');

-- The maker unpublishes: the second account''s set keeps its layout, but can no longer read the template.
select pg_temp.act_as('dddddddd-0000-4000-8000-000000000001');
update templates set is_public = false where id = '97979797-0000-4000-8000-000000000002';
select pg_temp.act_as('dddddddd-0000-4000-8000-000000000002');
select is((select count(*)::int from templates where id = '97979797-0000-4000-8000-000000000002'), 0, 'user: an unpublished template disappears from the row (the set keeps its own layout)');

select * from finish();
rollback;
