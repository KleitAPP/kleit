-- Tests for comments, likes and reactions (migration 029; roadmap M5.4 "Done when": comments
-- respect the per-set setting; a 15-minute edit window works; turning comments off hides
-- without deleting).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(17);

insert into auth.users (id, email) values
  ('acacacac-0000-4000-8000-000000000001', 'setowner@test.kleit'),
  ('acacacac-0000-4000-8000-000000000002', 'commenter@test.kleit'),
  ('acacacac-0000-4000-8000-000000000003', 'followed@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('acacacac-0000-4000-8000-000000000001', 'setowner', now(), 't'),
  ('acacacac-0000-4000-8000-000000000002', 'commenter', now(), 't'),
  ('acacacac-0000-4000-8000-000000000003', 'followed', now(), 't');
insert into follows (follower_id, followee_id) values ('acacacac-0000-4000-8000-000000000001', 'acacacac-0000-4000-8000-000000000003');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('92929292-0000-4000-8000-000000000001', 'acacacac-0000-4000-8000-000000000001', 'open set', 'published', 'public', 'commentspublic01'),
  ('92929292-0000-4000-8000-000000000002', 'acacacac-0000-4000-8000-000000000001', 'secret set', 'published', 'only_me', 'commentsonlyme02');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Everyone may comment on a public set; nobody may on an only-me set they cannot see.
select pg_temp.act_as('acacacac-0000-4000-8000-000000000002');
select lives_ok($$ insert into comments (id, set_id, author_id, body) values ('91919191-0000-4000-8000-000000000001', '92929292-0000-4000-8000-000000000001', 'acacacac-0000-4000-8000-000000000002', 'love this') $$, 'commenter: can comment on a public set');
select throws_ok($$ insert into comments (set_id, author_id, body) values ('92929292-0000-4000-8000-000000000002', 'acacacac-0000-4000-8000-000000000002', 'hello?') $$, '42501', null, 'commenter: cannot comment on a set they cannot see');
select throws_ok($$ insert into comments (set_id, author_id, body) values ('92929292-0000-4000-8000-000000000001', 'acacacac-0000-4000-8000-000000000003', 'forged') $$, '42501', null, 'commenter: cannot comment as someone else');
select lives_ok($$ insert into likes (user_id, set_id) values ('acacacac-0000-4000-8000-000000000002', '92929292-0000-4000-8000-000000000001') $$, 'commenter: can like it');
select throws_ok($$ insert into likes (user_id, set_id) values ('acacacac-0000-4000-8000-000000000002', '92929292-0000-4000-8000-000000000002') $$, '42501', null, 'commenter: cannot like what they cannot see');
select throws_ok($$ insert into reactions (user_id, set_id, emoji) values ('acacacac-0000-4000-8000-000000000002', '92929292-0000-4000-8000-000000000001', '💩') $$, '23514', null, 'an unknown emoji is refused by the table itself (before any policy)');
select lives_ok($$ insert into reactions (user_id, set_id, emoji) values ('acacacac-0000-4000-8000-000000000002', '92929292-0000-4000-8000-000000000001', '🔥') $$, 'commenter: can react');

-- Editing: the author, inside 15 minutes; the words change and edited_at is stamped.
update comments set body = 'love this (edited)' where id = '91919191-0000-4000-8000-000000000001';
select is((select edited_at is not null from comments where id = '91919191-0000-4000-8000-000000000001'), true, 'author: edited inside the window, stamped');
-- Outside the window: age the row as the server, then try again.
reset role;
update comments set created_at = now() - interval '16 minutes' where id = '91919191-0000-4000-8000-000000000001';
select pg_temp.act_as('acacacac-0000-4000-8000-000000000002');
select throws_ok($$ update comments set body = 'too late' where id = '91919191-0000-4000-8000-000000000001' $$, '42501', null, 'author: cannot edit after 15 minutes');

-- The counts, as the commenter sees them.
select is((select likes from set_social('92929292-0000-4000-8000-000000000001')), 1::bigint, 'set_social: one like');
select is((select my_reaction from set_social('92929292-0000-4000-8000-000000000001')), '🔥', 'set_social: my reaction');

-- The owner: only people they follow, then off.
select pg_temp.act_as('acacacac-0000-4000-8000-000000000001');
update sets set comments_setting = 'following' where id = '92929292-0000-4000-8000-000000000001';
select pg_temp.act_as('acacacac-0000-4000-8000-000000000002');
select throws_ok($$ insert into comments (set_id, author_id, body) values ('92929292-0000-4000-8000-000000000001', 'acacacac-0000-4000-8000-000000000002', 'again') $$, '42501', null, 'commenter (not followed by the owner): refused under "people I follow"');
select pg_temp.act_as('acacacac-0000-4000-8000-000000000003');
select lives_ok($$ insert into comments (set_id, author_id, body) values ('92929292-0000-4000-8000-000000000001', 'acacacac-0000-4000-8000-000000000003', 'nice') $$, 'someone the owner follows: allowed');

select pg_temp.act_as('acacacac-0000-4000-8000-000000000001');
update sets set comments_setting = 'off' where id = '92929292-0000-4000-8000-000000000001';
select is((select count(*)::int from comments where set_id = '92929292-0000-4000-8000-000000000001'), 2, 'owner: still sees the comments with the setting off');
select pg_temp.act_as('acacacac-0000-4000-8000-000000000002');
select is((select count(*)::int from comments where set_id = '92929292-0000-4000-8000-000000000001'), 0, 'commenter: sees none with the setting off (hidden, not deleted)');
select pg_temp.act_as('acacacac-0000-4000-8000-000000000001');
update sets set comments_setting = 'everyone' where id = '92929292-0000-4000-8000-000000000001';
select pg_temp.act_as('acacacac-0000-4000-8000-000000000002');
select is((select count(*)::int from comments where set_id = '92929292-0000-4000-8000-000000000001'), 2, 'commenter: they are back when it is on again');

-- The owner removes one; the row stays, marked with who removed it.
select pg_temp.act_as('acacacac-0000-4000-8000-000000000001');
update comments set deleted_at = now() where id = '91919191-0000-4000-8000-000000000001';
select is((select deleted_by from comments where id = '91919191-0000-4000-8000-000000000001'), 'acacacac-0000-4000-8000-000000000001'::uuid, 'owner: removed it, and the row says who');

select * from finish();
rollback;
