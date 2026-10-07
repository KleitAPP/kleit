-- Tests for migration 065 (the independent review's doors).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(13);

insert into auth.users (id, email) values
  ('ebebebeb-0000-4000-8000-000000000001', 'rv-victim@test.kleit'),
  ('ebebebeb-0000-4000-8000-000000000002', 'rv-attacker@test.kleit'),
  ('ebebebeb-0000-4000-8000-000000000003', 'rv-moderator@test.kleit'),
  ('ebebebeb-0000-4000-8000-000000000004', 'rv-reporter@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('ebebebeb-0000-4000-8000-000000000001', 'rvvictim', now(), 't'),
  ('ebebebeb-0000-4000-8000-000000000002', 'rvattacker', now(), 't'),
  ('ebebebeb-0000-4000-8000-000000000003', 'rvmoderator', now(), 't'),
  ('ebebebeb-0000-4000-8000-000000000004', 'rvreporter', now(), 't');
insert into user_roles (user_id, role) values ('ebebebeb-0000-4000-8000-000000000003', 'moderator');
insert into items (id, owner_id, kind, title, image_id, image_bucket) values
  ('eb000000-0000-4000-8000-000000000001', 'ebebebeb-0000-4000-8000-000000000001', 'own', 'victim photo', 'ebebebeb-0000-4000-8000-000000000001/v.jpg', 'closet-photos');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('eb000000-0000-4000-8000-000000000011', 'ebebebeb-0000-4000-8000-000000000002', 'attacker set', 'published', 'public', 'reviewfixes00001', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 1. A member cannot point an items row at someone else's file, nor start it taken down.
select pg_temp.act_as('ebebebeb-0000-4000-8000-000000000002');
select throws_ok($$ insert into items (owner_id, kind, title, image_id, image_bucket) values ('ebebebeb-0000-4000-8000-000000000002', 'own', 'forged', 'ebebebeb-0000-4000-8000-000000000001/v.jpg', 'closet-photos') $$, '42501', null, 'attacker: cannot name a file in someone else''s folder');
select throws_ok($$ insert into items (owner_id, kind, title, image_id, image_bucket, takedown_state) values ('ebebebeb-0000-4000-8000-000000000002', 'own', 'forged', 'ebebebeb-0000-4000-8000-000000000002/x.jpg', 'closet-photos', 'removed') $$, '42501', null, 'attacker: cannot start a row taken down');
select lives_ok($$ insert into items (id, owner_id, kind, title, image_id, image_bucket) values ('eb000000-0000-4000-8000-000000000002', 'ebebebeb-0000-4000-8000-000000000002', 'own', 'mine', 'ebebebeb-0000-4000-8000-000000000002/mine.jpg', 'closet-photos') $$, 'attacker: a file in their own folder is fine');
update items set deleted_at = now() - interval '40 days' where id = 'eb000000-0000-4000-8000-000000000002';
select ok((select deleted_at > now() - interval '1 minute' from items where id = 'eb000000-0000-4000-8000-000000000002'), 'attacker: a deletion is stamped now, never backdated');

-- 2. A report is acted on once; staff are not struck; the target cannot be repointed.
select pg_temp.act_as('ebebebeb-0000-4000-8000-000000000004');
select lives_ok($$ select file_report('set', 'eb000000-0000-4000-8000-000000000011', 'spam', 'x') $$, 'reporter: files');
select pg_temp.act_as('ebebebeb-0000-4000-8000-000000000003');
select throws_ok($$ update reports set target_owner_id = 'ebebebeb-0000-4000-8000-000000000001' where target_id = 'eb000000-0000-4000-8000-000000000011' $$, '42501', null, 'moderator: cannot repoint a report at another person');
select lives_ok($$ select moderate((select id from reports where target_id = 'eb000000-0000-4000-8000-000000000011'), 'strike', 'x') $$, 'moderator: strikes once');
select throws_ok($$ select moderate((select id from reports where target_id = 'eb000000-0000-4000-8000-000000000011'), 'strike', 'again') $$, 'P0002', null, 'moderator: cannot act on the same report twice');
select is((select count(*)::int from strikes where user_id = 'ebebebeb-0000-4000-8000-000000000002'), 1, 'attacker: has exactly one strike');

-- 3. A suspension is remembered; lifting it forgets.
select lives_ok($$ select set_suspended('ebebebeb-0000-4000-8000-000000000002', true, 'review test') $$, 'moderator: suspends');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from blocked_identities where reason = 'ban: review test'), 1, 'server: the suspension remembered the identity');
select pg_temp.act_as('ebebebeb-0000-4000-8000-000000000003');
select lives_ok($$ select set_suspended('ebebebeb-0000-4000-8000-000000000002', false, 'review test') $$, 'moderator: lifts it');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from blocked_identities where reason = 'ban: review test'), 0, 'server: and the identity row went with it');

select * from finish();
rollback;
