-- Tests for tags (migration 041; roadmap M6.1 "Done when": a private set never appears in any
-- search result - the tag page and the popular list included).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('e0e0e0e0-0000-4000-8000-000000000001', 'tagger@test.kleit'),
  ('e0e0e0e0-0000-4000-8000-000000000002', 'reader@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e0e0e0e0-0000-4000-8000-000000000001', 'tagger', now(), 't'),
  ('e0e0e0e0-0000-4000-8000-000000000002', 'reader', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, tags) values
  ('ee000000-0000-4000-8000-000000000001', 'e0e0e0e0-0000-4000-8000-000000000001', 'tagged public', 'published', 'public', 'tagspublic000001', now(), '{autumn-layers-test,wool}'),
  ('ee000000-0000-4000-8000-000000000002', 'e0e0e0e0-0000-4000-8000-000000000001', 'tagged only me', 'published', 'only_me', 'tagsonlyme000002', now(), '{autumn-layers-test}'),
  ('ee000000-0000-4000-8000-000000000003', 'e0e0e0e0-0000-4000-8000-000000000001', 'tagged draft', 'draft', 'public', 'tagsdraft0000003', null, '{autumn-layers-test}');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The shape.
select pg_temp.act_as('e0e0e0e0-0000-4000-8000-000000000001');
select throws_ok($$ update sets set tags = '{Autumn}' where id = 'ee000000-0000-4000-8000-000000000001' $$, '23514', null, 'tagger: a capital letter is refused (tags are lowercase)');
select throws_ok($$ update sets set tags = '{"two words"}' where id = 'ee000000-0000-4000-8000-000000000001' $$, '23514', null, 'tagger: a space is refused');
select throws_ok($$ update sets set tags = '{wool,wool}' where id = 'ee000000-0000-4000-8000-000000000001' $$, '23514', null, 'tagger: a duplicate is refused');
select lives_ok($$ update sets set tags = '{autumn-layers-test,wool,y2k}' where id = 'ee000000-0000-4000-8000-000000000001' $$, 'tagger: three good tags are fine');

-- The reads, as a stranger.
select pg_temp.act_as('e0e0e0e0-0000-4000-8000-000000000002');
select is((select count(*)::int from sets_by_tag('autumn-layers-test')), 1, 'reader: the tag page shows the public set only - not the only-me one, not the draft');
select is((select sets from popular_tags(100) where tag = 'autumn-layers-test'), 1::bigint, 'reader: the popular list counts only what the reader could open');
select ok(exists (select 1 from search_sets('wool') where id = 'ee000000-0000-4000-8000-000000000001'), 'reader: a tag word finds the set in search');
select pg_temp.act_as('e0e0e0e0-0000-4000-8000-000000000001');
select is((select count(*)::int from sets_by_tag('autumn-layers-test')), 2, 'tagger: sees their own only-me set on the tag page too, never the draft');

select * from finish();
rollback;
