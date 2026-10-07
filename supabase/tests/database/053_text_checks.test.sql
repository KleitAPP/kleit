-- Tests for migration 071: comments, captions and bios are queued for the outside check; a
-- flagged answer holds a comment and files a report; an ok answer changes nothing; a member
-- never sees the queue.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('efefefef-0000-4000-8000-000000000001', 'tc-owner@test.kleit'),
  ('efefefef-0000-4000-8000-000000000002', 'tc-talker@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('efefefef-0000-4000-8000-000000000001', 'tcowner', now(), 't'),
  ('efefefef-0000-4000-8000-000000000002', 'tctalker', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ef000000-0000-4000-8000-000000000001', 'efefefef-0000-4000-8000-000000000001', 'checked set', 'published', 'public', 'textchecks000001', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('efefefef-0000-4000-8000-000000000002');
insert into comments (id, set_id, author_id, body) values ('ef000000-0000-4000-8000-000000000011', 'ef000000-0000-4000-8000-000000000001', 'efefefef-0000-4000-8000-000000000002', 'nice coat');
update profiles set bio = 'hello world' where user_id = 'efefefef-0000-4000-8000-000000000002';
select throws_ok($$ select * from text_checks $$, '42501', null, 'talker: cannot read the queue');
select throws_ok($$ select * from claim_text_checks(5) $$, '42501', null, 'talker: cannot claim from it');
select pg_temp.act_as('efefefef-0000-4000-8000-000000000001');
update sets set layout = '{"caption":"autumn layers"}' where id = 'ef000000-0000-4000-8000-000000000001';

reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from text_checks where target_id in ('ef000000-0000-4000-8000-000000000011', 'efefefef-0000-4000-8000-000000000002', 'ef000000-0000-4000-8000-000000000001') and state = 'pending'), 3, 'server: the comment, the bio and the caption are queued');
create temp table batch as select * from claim_text_checks(50);
select ok((select count(*) from batch where target_id = 'ef000000-0000-4000-8000-000000000011') = 1, 'server: the batch holds the comment');
select lives_ok($$ select record_text_check((select id from batch where kind = 'comment'), 'ok') $$, 'server: records ok');
select lives_ok($$ select record_text_check((select id from batch where kind = 'caption'), 'flagged', '{"self-harm": true}'::jsonb) $$, 'server: records a flagged caption');
select is((select held_at is null from comments where id = 'ef000000-0000-4000-8000-000000000011'), true, 'server: an ok comment is not held');
select is((select count(*)::int from reports where target_type = 'set' and target_id = 'ef000000-0000-4000-8000-000000000001' and note = 'caption flagged by the moderation check' and reason = 'self_harm'), 1, 'server: the flagged caption is reported, with the reason read off the labels');

select * from finish();
rollback;
