-- Tests for migration 011 — the buckets and clip_records (roadmap M2.3; technical pack §7 #1).
-- The waypoint's own "Done when": a 25 MB file is refused, and writing into another person's
-- folder is refused. Both are checked here against the rules themselves, plus the whole of
-- technical pack §3.1 read back bucket by bucket. Rolled back; nothing is left behind.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@test.kleit'),
  ('22222222-2222-4222-8222-222222222222', 'stranger@test.kleit');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  if uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  end if;
end $$;
grant execute on function pg_temp.act_as(text) to anon, authenticated;

-- ---------------- the buckets exist, and are shaped as the pack says ----------------
select is(
  (select count(*)::int from storage.buckets
    where id in ('avatars','item-images','closet-photos','set-previews',
                 'exports','private-fonts','evidence','id-verification')),
  8, 'all eight buckets from technical pack 3.1 exist');

select is(
  (select count(*)::int from storage.buckets where public),
  2, 'exactly two buckets are public to read: avatars and set-previews');

select ok(
  (select not public from storage.buckets where id = 'item-images'),
  'item-images is NOT public - a bucket cannot read the screening result, so a public one would serve an unscanned photo');

select ok(
  (select bool_and(not public) from storage.buckets
    where id in ('closet-photos','exports','private-fonts','evidence','id-verification')),
  'every private bucket is private');

-- The waypoint's own test: 25 MB is refused everywhere a person can upload.
select ok(
  (select bool_and(file_size_limit < 26214400) from storage.buckets
    where id in ('avatars','item-images','closet-photos','set-previews','private-fonts')),
  'a 25 MB file is over the limit on every bucket a person can put a photo in');

select ok(
  (select bool_and('image/svg+xml' <> all(coalesce(allowed_mime_types, array[]::text[])))
     from storage.buckets where id in ('avatars','item-images','closet-photos','set-previews')),
  'no image bucket accepts SVG - an SVG is a script that renders as a picture');

-- ---------------- your folder is yours ----------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select lives_ok($$ insert into storage.objects (bucket_id, name)
                   values ('closet-photos', '11111111-1111-4111-8111-111111111111/coat.jpg') $$,
  'closet-photos: a person can write into their own folder');
select throws_ok($$ insert into storage.objects (bucket_id, name)
                    values ('closet-photos', '22222222-2222-4222-8222-222222222222/coat.jpg') $$,
  '42501', null, 'closet-photos: writing into someone else''s folder is refused');

select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from storage.objects where bucket_id = 'closet-photos'), 0,
  'closet-photos: a second account cannot see your clothes');

select pg_temp.act_as(null);
select is((select count(*)::int from storage.objects where bucket_id = 'closet-photos'), 0,
  'closet-photos: a signed-out visitor cannot see them either');

-- ---------------- clip_records is a record, not a diary the user writes ----------------
select pg_temp.act_as('11111111-1111-4111-8111-111111111111');
select throws_ok($$ insert into clip_records (user_id, trigger)
                    values ('11111111-1111-4111-8111-111111111111', 'upload') $$,
  '42501', null, 'clip_records: not even the owner may write their own record (decision 103)');

reset role;
insert into clip_records (user_id, trigger, source_url)
  values ('11111111-1111-4111-8111-111111111111', 'paste_link', 'https://shop.example.com/coat');
select pg_temp.act_as('22222222-2222-4222-8222-222222222222');
select is((select count(*)::int from clip_records), 0,
  'clip_records: a second account cannot read whose image came from where');

select * from finish();
rollback;
