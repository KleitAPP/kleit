-- Tests for migration 062: phone numbers and addresses are refused in captions, bios and
-- comments; a comment reaching for eating-disorder language is held (author only) and reported;
-- a moderator's dismiss lets it show; a caption with the same is published but reported.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(15);

insert into auth.users (id, email) values
  ('e8e8e8e8-0000-4000-8000-000000000001', 'ts-owner@test.kleit'),
  ('e8e8e8e8-0000-4000-8000-000000000002', 'ts-commenter@test.kleit'),
  ('e8e8e8e8-0000-4000-8000-000000000003', 'ts-moderator@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e8e8e8e8-0000-4000-8000-000000000001', 'tsowner', now(), 't'),
  ('e8e8e8e8-0000-4000-8000-000000000002', 'tscommenter', now(), 't'),
  ('e8e8e8e8-0000-4000-8000-000000000003', 'tsmoderator', now(), 't');
insert into user_roles (user_id, role) values ('e8e8e8e8-0000-4000-8000-000000000003', 'moderator');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('e8000000-0000-4000-8000-000000000001', 'e8e8e8e8-0000-4000-8000-000000000001', 'screened set', 'published', 'public', 'textscreen000001', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The verdict itself.
select pg_temp.act_as('e8e8e8e8-0000-4000-8000-000000000002');
select is(text_verdict('love this coat', 'comment'), 'ok', 'verdict: ordinary words are fine');
select is(text_verdict('call me 555-123-4567', 'caption'), 'refuse', 'verdict: a phone number in a caption is refused');
select is(text_verdict('come by 12 Main Street', 'bio'), 'refuse', 'verdict: a street address in a bio is refused');
select is(text_verdict('skinny jeans and a 50 dollar coat', 'caption'), 'ok', 'verdict: a cut and a price are not a phone number or a phrase');
select is(text_verdict('thinspo goals', 'comment'), 'hold', 'verdict: an eating-disorder phrase is held');
select is(text_verdict('a purge of my closet', 'comment'), 'hold', 'verdict: the search-card list is the same list (a risky word holds a comment too)');

-- A comment.
select throws_ok($$ insert into comments (set_id, author_id, body) values ('e8000000-0000-4000-8000-000000000001', 'e8e8e8e8-0000-4000-8000-000000000002', 'text me at (555) 123 4567') $$, 'P0006', null, 'commenter: a phone number is refused');
select lives_ok($$ insert into comments (id, set_id, author_id, body) values ('e8000000-0000-4000-8000-000000000011', 'e8000000-0000-4000-8000-000000000001', 'e8e8e8e8-0000-4000-8000-000000000002', 'thinspo vibes') $$, 'commenter: a risky comment is saved');
select is((select count(*)::int from comments where id = 'e8000000-0000-4000-8000-000000000011'), 1, 'commenter: and sees it themselves');
select pg_temp.act_as('e8e8e8e8-0000-4000-8000-000000000001');
select is((select count(*)::int from comments where id = 'e8000000-0000-4000-8000-000000000011'), 0, 'owner: does not see the held comment');
select pg_temp.act_as('e8e8e8e8-0000-4000-8000-000000000003');
select is((select count(*)::int from reports where target_type = 'comment' and target_id = 'e8000000-0000-4000-8000-000000000011' and state = 'open'), 1, 'moderator: the held comment is in the queue, reported by the word list');
select lives_ok($$ select moderate((select id from reports where target_id = 'e8000000-0000-4000-8000-000000000011'), 'dismiss', 'a closet, not a person') $$, 'moderator: dismisses it');
select pg_temp.act_as('e8e8e8e8-0000-4000-8000-000000000001');
select is((select count(*)::int from comments where id = 'e8000000-0000-4000-8000-000000000011'), 1, 'owner: sees the comment once it is dismissed');

-- A caption and a bio.
select throws_ok($$ update sets set layout = '{"caption":"dm me 5551234567"}' where id = 'e8000000-0000-4000-8000-000000000001' $$, 'P0006', null, 'owner: a phone number in a caption is refused');
select throws_ok($$ update profiles set bio = 'find me at 4 Oak Ave' where user_id = 'e8e8e8e8-0000-4000-8000-000000000001' $$, 'P0006', null, 'owner: an address in a bio is refused');

select * from finish();
rollback;
