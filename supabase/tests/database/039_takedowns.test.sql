-- Tests for takedown requests (migration 050; roadmap M7.4 "Done when": both forms work with no
-- account, issue a reference, and remove identical copies by fingerprint).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('e2e2e2e2-0000-4000-8000-000000000001', 'td-owner@test.kleit'),
  ('e2e2e2e2-0000-4000-8000-000000000002', 'td-copier@test.kleit'),
  ('e2e2e2e2-0000-4000-8000-000000000003', 'td-moderator@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e2e2e2e2-0000-4000-8000-000000000001', 'tdowner', now(), 't'),
  ('e2e2e2e2-0000-4000-8000-000000000002', 'tdcopier', now(), 't'),
  ('e2e2e2e2-0000-4000-8000-000000000003', 'tdmoderator', now(), 't');
insert into user_roles (user_id, role) values ('e2e2e2e2-0000-4000-8000-000000000003', 'moderator');
-- Two people stored the same picture (same fingerprint); a third picture is different.
insert into items (id, owner_id, kind, title, image_hash) values
  ('e2000000-0000-4000-8000-000000000001', 'e2e2e2e2-0000-4000-8000-000000000001', 'own', 'the picture', 'deadbeefdeadbeef'),
  ('e2000000-0000-4000-8000-000000000002', 'e2e2e2e2-0000-4000-8000-000000000002', 'own', 'a copy of it', 'deadbeefdeadbeef'),
  ('e2000000-0000-4000-8000-000000000003', 'e2e2e2e2-0000-4000-8000-000000000002', 'own', 'something else', 'cafebabecafebabe');
-- The row the function writes for a sender with no account.
insert into takedown_requests (id, request_ref, kind, name, email, urls, details) values
  ('e2000000-0000-4000-8000-000000000011', 'T-TESTONE', 'intimate', 'A. Person', 'person@example.com', '{https://kleit-test.example/item/e2000000-0000-4000-8000-000000000001}', 'that is me');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The sender, with no account, checks by reference and sees the state only.
set role anon;
select is((select state from takedown_status('t-testone')), 'open', 'anon: the sender sees the state by reference, any case');
select is((select count(*)::int from takedown_status('T-NOPE')), 0, 'anon: a wrong reference shows nothing');
select throws_ok($$ select * from takedown_requests $$, '42501', null, 'anon: the table itself is closed');
reset role;

-- A plain person cannot resolve; a moderator can, and identical copies go with the picture.
select pg_temp.act_as('e2e2e2e2-0000-4000-8000-000000000002');
select throws_ok($$ select takedown_resolve('e2000000-0000-4000-8000-000000000011', 'removed') $$, '42501', null, 'copier: cannot resolve a takedown');
select pg_temp.act_as('e2e2e2e2-0000-4000-8000-000000000003');
select is((select takedown_resolve('e2000000-0000-4000-8000-000000000011', 'removed', 'confirmed', 'e2000000-0000-4000-8000-000000000001')), 2, 'moderator: removing the picture removed both stored copies');
reset role; select set_config('request.jwt.claims', '', true);
select is((select takedown_state::text from items where id = 'e2000000-0000-4000-8000-000000000003'), 'none', 'the different picture is untouched');
select is((select count(*)::int from removed_image_fingerprints where image_hash = 'deadbeefdeadbeef'), 1, 'the fingerprint is on the never-again list');
set role anon;
select is((select state from takedown_status('T-TESTONE')), 'removed', 'anon: the sender now sees "removed"');

select * from finish();
rollback;
