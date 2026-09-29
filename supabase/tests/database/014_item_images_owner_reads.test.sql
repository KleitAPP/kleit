-- Tests for migration 016 — the clipper may see their own clipped picture; nobody else may.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(4);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@test.kleit'),
  ('22222222-2222-4222-8222-222222222222', 'other@test.kleit');

-- Two stored pictures, one per person, written the way the server writes them.
insert into storage.objects (bucket_id, name, owner)
values ('item-images', '11111111-1111-4111-8111-111111111111/a.jpg', null),
       ('item-images', '22222222-2222-4222-8222-222222222222/b.jpg', null);

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select is((select count(*) from storage.objects where bucket_id = 'item-images'), 1::bigint,
  'the owner sees exactly their own clipped picture');
select is((select name from storage.objects where bucket_id = 'item-images'), '11111111-1111-4111-8111-111111111111/a.jpg',
  'and it is theirs, not the other person''s');
reset role;
select set_config('request.jwt.claims', '', true);

set role anon;
select is((select count(*) from storage.objects where bucket_id = 'item-images'), 0::bigint,
  'a signed-out visitor sees nothing in item-images');
reset role;

select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname like 'item-images:%' and cmd in ('INSERT', 'UPDATE', 'DELETE')), 0::bigint,
  'no person may write, change or delete anything in item-images');

select * from finish();
rollback;
