-- Tests for migration 069 (the second review's findings).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into auth.users (id, email) values
  ('eeeeeeee-1000-4000-8000-000000000001', 'sr-member@test.kleit'),
  ('eeeeeeee-1000-4000-8000-000000000002', 'sr-other@test.kleit'),
  ('eeeeeeee-1000-4000-8000-000000000003', 'sr-moderator@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('eeeeeeee-1000-4000-8000-000000000001', 'srmember', now(), 't'),
  ('eeeeeeee-1000-4000-8000-000000000002', 'srother', now(), 't'),
  ('eeeeeeee-1000-4000-8000-000000000003', 'srmoderator', now(), 't');
insert into user_roles (user_id, role) values ('eeeeeeee-1000-4000-8000-000000000003', 'moderator');
insert into items (id, owner_id, kind, title, image_id, image_bucket) values
  ('ee100000-0000-4000-8000-000000000001', 'eeeeeeee-1000-4000-8000-000000000001', 'own', 'mine', 'eeeeeeee-1000-4000-8000-000000000001/a.jpg', 'closet-photos');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ee100000-0000-4000-8000-000000000011', 'eeeeeeee-1000-4000-8000-000000000001', 'set', 'published', 'public', 'secondreview0001', now());
insert into strikes (id, user_id, reason) values ('ee100000-0000-4000-8000-000000000021', 'eeeeeeee-1000-4000-8000-000000000002', 'theirs');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('eeeeeeee-1000-4000-8000-000000000001');
select throws_ok($$ insert into items (owner_id, kind, title, image_id, image_bucket) values ('eeeeeeee-1000-4000-8000-000000000001', 'own', 'twin', 'eeeeeeee-1000-4000-8000-000000000001/a.jpg', 'closet-photos') $$, '42501', null, 'member: cannot make a second row on the same file');
select throws_ok($$ update items set image_id = null where id = 'ee100000-0000-4000-8000-000000000001' $$, '42501', null, 'member: cannot clear a row''s file path');
select throws_ok($$ insert into appeals (strike_id, user_id, body) values ('ee100000-0000-4000-8000-000000000021', 'eeeeeeee-1000-4000-8000-000000000001', 'not mine') $$, '42501', null, 'member: cannot appeal someone else''s strike');

select pg_temp.act_as('eeeeeeee-1000-4000-8000-000000000002');
select lives_ok($$ select file_report('set', 'ee100000-0000-4000-8000-000000000011', 'spam', 'x') $$, 'other: reports');
select pg_temp.act_as('eeeeeeee-1000-4000-8000-000000000003');
select lives_ok($$ select moderate((select id from reports where target_id = 'ee100000-0000-4000-8000-000000000011'), 'dismiss', 'x') $$, 'moderator: dismisses');
select throws_ok($$ update reports set state = 'open' where target_id = 'ee100000-0000-4000-8000-000000000011' $$, '42501', null, 'moderator: cannot reopen a resolved report');

-- A declined request does not come back by writing again.
select pg_temp.act_as('eeeeeeee-1000-4000-8000-000000000001');
update profiles set dm_setting = 'everyone' where user_id = 'eeeeeeee-1000-4000-8000-000000000001';
select pg_temp.act_as('eeeeeeee-1000-4000-8000-000000000002');
update profiles set dm_setting = 'everyone' where user_id = 'eeeeeeee-1000-4000-8000-000000000002';
select pg_temp.act_as('eeeeeeee-1000-4000-8000-000000000001');
select send_message('eeeeeeee-1000-4000-8000-000000000002', 'hey');
select pg_temp.act_as('eeeeeeee-1000-4000-8000-000000000002');
select leave_conversation((select id from conversations where user_a = least('eeeeeeee-1000-4000-8000-000000000001'::uuid, 'eeeeeeee-1000-4000-8000-000000000002'::uuid)));
select pg_temp.act_as('eeeeeeee-1000-4000-8000-000000000001');
select throws_ok($$ select send_message('eeeeeeee-1000-4000-8000-000000000002', 'hey again') $$, 'P0001', null, 'member: a request the other person declined does not come back');

select * from finish();
rollback;
