-- Tests for migration 106 (spec 8.2 #3; CL63): the creator preview's set count is the owner's
-- published, public, live sets - not drafts, not Only-me sets, not deleted ones.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(3);

insert into auth.users (id, email) values ('a7a7a7a7-0000-4000-8000-000000000001', 'cp7-owner@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('a7a7a7a7-0000-4000-8000-000000000001', 'cpseven', now(), 't');
insert into sets (id, owner_id, title, status, visibility, published_at, share_code, layout) values
  ('a7000000-0000-4000-8000-000000000001', 'a7a7a7a7-0000-4000-8000-000000000001', 'public one', 'published', 'public', now() - interval '2 days', 'cpseven000000001', '{"version":1,"template":"","background":"#ffffff","caption":""}'),
  ('a7000000-0000-4000-8000-000000000002', 'a7a7a7a7-0000-4000-8000-000000000001', 'public two', 'published', 'public', now() - interval '1 day', 'cpseven000000002', '{"version":1,"template":"","background":"#ffffff","caption":""}'),
  ('a7000000-0000-4000-8000-000000000003', 'a7a7a7a7-0000-4000-8000-000000000001', 'only me', 'published', 'only_me', now() - interval '1 day', 'cpseven000000003', '{"version":1,"template":"","background":"#ffffff","caption":""}'),
  ('a7000000-0000-4000-8000-000000000004', 'a7a7a7a7-0000-4000-8000-000000000001', 'a draft', 'draft', 'public', null, 'cpseven000000004', '{"version":1,"template":"","background":"#ffffff","caption":""}');

select is((shared_set('cpseven000000001') -> 'owner' ->> 'set_count')::int, 2, 'set_count: the two public published sets, not the Only-me one or the draft');
update sets set deleted_at = now() where id = 'a7000000-0000-4000-8000-000000000002';
select is((shared_set('cpseven000000001') -> 'owner' ->> 'set_count')::int, 1, 'a deleted set leaves the count');
select ok((shared_set('cpseven000000001') -> 'owner') ? 'username', 'the rest of the owner card is still there');

select * from finish();
rollback;
