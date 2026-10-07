-- Tests for migration 063: a ban remembers hashes of the account's email and sign-in identity;
-- a new account on the same email cannot open a profile; a different email can; nothing in the
-- table is an address.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(7);

insert into auth.users (id, email) values
  ('e9e9e9e9-0000-4000-8000-000000000001', 'Banned.Person@Example.com'),
  ('e9e9e9e9-0000-4000-8000-000000000002', 'bi-moderator@test.kleit'),
  ('e9e9e9e9-0000-4000-8000-000000000003', 'bi-reporter@test.kleit'),
  ('e9e9e9e9-0000-4000-8000-000000000004', 'banned.person@example.com'),
  ('e9e9e9e9-0000-4000-8000-000000000005', 'somebody.else@example.com');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e9e9e9e9-0000-4000-8000-000000000001', 'bannedperson', now(), 't'),
  ('e9e9e9e9-0000-4000-8000-000000000002', 'bimoderator', now(), 't'),
  ('e9e9e9e9-0000-4000-8000-000000000003', 'bireporter', now(), 't');
insert into user_roles (user_id, role) values ('e9e9e9e9-0000-4000-8000-000000000002', 'moderator');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('e9000000-0000-4000-8000-000000000001', 'e9e9e9e9-0000-4000-8000-000000000001', 'bad set', 'published', 'public', 'bannedident00001', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A report, then a ban.
select pg_temp.act_as('e9e9e9e9-0000-4000-8000-000000000003');
select lives_ok($$ select file_report('set', 'e9000000-0000-4000-8000-000000000001', 'hate', 'awful') $$, 'reporter: files the report');
select pg_temp.act_as('e9e9e9e9-0000-4000-8000-000000000002');
select lives_ok($$ select moderate((select id from reports where target_id = 'e9000000-0000-4000-8000-000000000001'), 'ban', 'out') $$, 'moderator: bans');

-- The record: a hash, never the address.
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from blocked_identities where reason like 'ban: report K-%'), 1, 'server: one identity row was written by the ban');
select ok((select bool_and(email_hash !~* '@' and length(email_hash) = 64) from blocked_identities where reason like 'ban: report K-%'), 'server: the row holds a 64-character hash, not an email address');

-- Coming back on the same email, in any case: refused. Somebody else: fine.
select pg_temp.act_as('e9e9e9e9-0000-4000-8000-000000000004');
select throws_ok($$ select claim_profile('backagain', '', 'v0.1') $$, 'P0007', null, 'the banned person: cannot open a new account on the same email');
select pg_temp.act_as('e9e9e9e9-0000-4000-8000-000000000005');
select lives_ok($$ select claim_profile('somebodyelse', '', 'v0.1') $$, 'somebody else: opens an account');
select is((select username from profiles where user_id = 'e9e9e9e9-0000-4000-8000-000000000005'), 'somebodyelse', 'somebody else: and has it');

select * from finish();
rollback;
