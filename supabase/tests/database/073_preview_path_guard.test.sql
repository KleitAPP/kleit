-- Tests for migration 097: the chat picture's path on a set is the server's - a member's row
-- never arrives pointing at a file, and the path never moves by hand (set-preview writes it
-- with the service key and removes only a file under its own set's folder).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(4);

insert into auth.users (id, email) values ('f1f1f1f1-0000-4000-8000-000000000001', 'pp-guard@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('f1f1f1f1-0000-4000-8000-000000000001', 'ppguard', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, preview_image_id) values
  ('f1000000-0000-4000-8000-000000000001', 'f1f1f1f1-0000-4000-8000-000000000001', 'pp drawn', 'published', 'public', 'ppguarddrawn0001', now(), 'f1000000-0000-4000-8000-000000000001/1.jpg');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create temp table pg_ids (name text primary key, id uuid);
grant all on pg_ids to authenticated;

select pg_temp.act_as('f1f1f1f1-0000-4000-8000-000000000001');
with x as (insert into sets (owner_id, title, status, visibility, preview_image_id) values ('f1f1f1f1-0000-4000-8000-000000000001', 'pp by hand', 'draft', 'only_me', 'someone-else/1.jpg') returning id)
insert into pg_ids (name, id) select 'hand', id from x;
select is((select preview_image_id from sets where id = (select id from pg_ids where name = 'hand')), null, 'owner: a new set never arrives pointing at a file');
select throws_ok($$ update sets set preview_image_id = 'someone-else/1.jpg' where id = 'f1000000-0000-4000-8000-000000000001' $$, '42501', null, 'owner: cannot point their set at another file');
select throws_ok($$ update sets set preview_image_id = null where id = 'f1000000-0000-4000-8000-000000000001' $$, '42501', null, 'owner: cannot clear it by hand either');
select lives_ok($$ update sets set title = 'pp drawn still' where id = 'f1000000-0000-4000-8000-000000000001' $$, 'owner: the rest of the set is theirs');

select * from finish();
rollback;
