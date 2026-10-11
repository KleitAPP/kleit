-- Tests for migration 081 (mentions): "@name" in a comment tells that person by their own rule
-- (everyone / people I follow / nobody); never the author, never the set's owner twice, never
-- across a block, never from a held comment; at most five names.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values
  ('adadadad-0000-4000-8000-000000000001', 'm-owner@test.kleit'),
  ('adadadad-0000-4000-8000-000000000002', 'm-writer@test.kleit'),
  ('adadadad-0000-4000-8000-000000000003', 'm-open@test.kleit'),
  ('adadadad-0000-4000-8000-000000000004', 'm-follows@test.kleit'),
  ('adadadad-0000-4000-8000-000000000005', 'm-closed@test.kleit'),
  ('adadadad-0000-4000-8000-000000000006', 'm-blocker@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version, mention_setting) values
  ('adadadad-0000-4000-8000-000000000001', 'mowner', now(), 't', 'everyone'),
  ('adadadad-0000-4000-8000-000000000002', 'mwriter', now(), 't', 'everyone'),
  ('adadadad-0000-4000-8000-000000000003', 'mopen', now(), 't', 'everyone'),
  ('adadadad-0000-4000-8000-000000000004', 'mfollows', now(), 't', 'following'),
  ('adadadad-0000-4000-8000-000000000005', 'mclosed', now(), 't', 'nobody'),
  ('adadadad-0000-4000-8000-000000000006', 'mblocker', now(), 't', 'everyone');
insert into follows (follower_id, followee_id) values ('adadadad-0000-4000-8000-000000000004', 'adadadad-0000-4000-8000-000000000002');
insert into blocks (blocker_id, blocked_id) values ('adadadad-0000-4000-8000-000000000006', 'adadadad-0000-4000-8000-000000000002');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ad000000-0000-4000-8000-000000000001', 'adadadad-0000-4000-8000-000000000001', 'the set', 'published', 'public', 'mentionset000001', now());

select is(private.mentioned_names('hey @MOpen and @mfollows, @mowner! not an email a@b.co @x'), array['mfollows', 'mopen', 'mowner'], 'the names are found, lower-cased, once each, and an email is not one');

insert into comments (set_id, author_id, body) values
  ('ad000000-0000-4000-8000-000000000001', 'adadadad-0000-4000-8000-000000000002', 'look @mopen @mfollows @mclosed @mblocker @mowner @mwriter');
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'adadadad-0000-4000-8000-000000000003'), 1, 'everyone: told');
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'adadadad-0000-4000-8000-000000000004'), 1, 'people I follow: told, because they follow the writer');
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'adadadad-0000-4000-8000-000000000005'), 0, 'nobody: not told');
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'adadadad-0000-4000-8000-000000000006'), 0, 'a blocker is not told');
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'adadadad-0000-4000-8000-000000000001'), 0, 'the set''s owner is not told twice (they hear of the comment)');
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'adadadad-0000-4000-8000-000000000002'), 0, 'the writer is not told of their own comment');

-- The follow rule the other way round: a stranger's @ is just text.
delete from follows where follower_id = 'adadadad-0000-4000-8000-000000000004';
insert into comments (set_id, author_id, body) values
  ('ad000000-0000-4000-8000-000000000001', 'adadadad-0000-4000-8000-000000000003', 'hi @mfollows');
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'adadadad-0000-4000-8000-000000000004' and actor_id = 'adadadad-0000-4000-8000-000000000003'), 0, 'people I follow: a stranger''s @ tells nothing');

-- A held comment tells nobody.
select set_config('kleit.server_write', '1', true);
insert into comments (set_id, author_id, body, held_at) values
  ('ad000000-0000-4000-8000-000000000001', 'adadadad-0000-4000-8000-000000000002', '@mopen again', now());
select set_config('kleit.server_write', '', true);
select is((select count(*)::int from notifications where kind = 'mention' and user_id = 'adadadad-0000-4000-8000-000000000003'), 1, 'a held comment tells nobody');

select * from finish();
rollback;
