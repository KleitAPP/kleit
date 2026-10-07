-- Tests for reports (migration 044; roadmap M7.1 "Done when": every set, item, comment,
-- profile, DM and group has a Report button that produces a reference number).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('a7a7a7a7-0000-4000-8000-000000000001', 'reporter@test.kleit'),
  ('a7a7a7a7-0000-4000-8000-000000000002', 'reported@test.kleit'),
  ('a7a7a7a7-0000-4000-8000-000000000003', 'moderator@test.kleit'),
  ('a7a7a7a7-0000-4000-8000-000000000004', 'bystander@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('a7a7a7a7-0000-4000-8000-000000000001', 'reporter', now(), 't'),
  ('a7a7a7a7-0000-4000-8000-000000000002', 'reported', now(), 't'),
  ('a7a7a7a7-0000-4000-8000-000000000003', 'moderator', now(), 't'),
  ('a7a7a7a7-0000-4000-8000-000000000004', 'bystander', now(), 't');
insert into user_roles (user_id, role) values ('a7a7a7a7-0000-4000-8000-000000000003', 'moderator');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('a7000000-0000-4000-8000-000000000001', 'a7a7a7a7-0000-4000-8000-000000000002', 'reported public', 'published', 'public', 'reportspublic001', now()),
  ('a7000000-0000-4000-8000-000000000002', 'a7a7a7a7-0000-4000-8000-000000000002', 'reported only me', 'published', 'only_me', 'reportsonlyme002', now()),
  ('a7000000-0000-4000-8000-000000000003', 'a7a7a7a7-0000-4000-8000-000000000001', 'reporter own', 'published', 'public', 'reportsown000003', now());
insert into comments (id, set_id, author_id, body) values
  ('a7000000-0000-4000-8000-000000000011', 'a7000000-0000-4000-8000-000000000001', 'a7a7a7a7-0000-4000-8000-000000000002', 'rude words');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- A conversation between reporter and reported, with a few lines (reported follows reporter,
-- so the reporter's default "followers" setting lets the first line in, as a request).
insert into follows (follower_id, followee_id) values ('a7a7a7a7-0000-4000-8000-000000000002', 'a7a7a7a7-0000-4000-8000-000000000001');
select pg_temp.act_as('a7a7a7a7-0000-4000-8000-000000000002');
select send_message('a7a7a7a7-0000-4000-8000-000000000001', 'hey');
select send_message('a7a7a7a7-0000-4000-8000-000000000001', 'send me money');
select pg_temp.act_as('a7a7a7a7-0000-4000-8000-000000000001');
select is((select count(*)::int from reports), 0, 'reporter: cannot read the reports table');
select throws_ok($$ insert into reports (request_ref, target_type, target_id, reason) values ('K-FORGED', 'set', 'a7000000-0000-4000-8000-000000000001', 'spam') $$, '42501', null, 'reporter: cannot write a report row by hand');
select matches((select file_report('set', 'a7000000-0000-4000-8000-000000000001', 'spam', 'ads')), '^K-[A-Z0-9]{8}$', 'reporter: a set report gives a reference number');
select is((select file_report('set', 'a7000000-0000-4000-8000-000000000001', 'spam')), (select request_ref from my_reports() where target_type = 'set'), 'reporter: the same thing twice is the same reference');
select matches((select file_report('comment', 'a7000000-0000-4000-8000-000000000011', 'harassment')), '^K-', 'reporter: a comment can be reported');
select matches((select file_report('profile', 'a7a7a7a7-0000-4000-8000-000000000002', 'impersonation')), '^K-', 'reporter: a profile can be reported');
select matches((select file_report('conversation', (select id from conversations limit 1), 'harassment')), '^K-', 'reporter: a conversation can be reported');
select throws_ok($$ select file_report('set', 'a7000000-0000-4000-8000-000000000002', 'spam') $$, 'P0002', null, 'reporter: a set they cannot see is "not found"');
select throws_ok($$ select file_report('set', 'a7000000-0000-4000-8000-000000000003', 'spam') $$, 'P0001', null, 'reporter: cannot report their own set');
select throws_ok($$ select file_report('profile', 'a7a7a7a7-0000-4000-8000-000000000004', 'rubbish') $$, '23514', null, 'reporter: an unknown reason is refused by the table (a fresh target - the same target again just returns the old reference)');
select is((select count(*)::int from my_reports()), 4, 'reporter: sees four of their own reports, state open');

-- A bystander cannot report the conversation they are not in.
select pg_temp.act_as('a7a7a7a7-0000-4000-8000-000000000004');
select throws_ok($$ select file_report('conversation', (select id from conversations limit 1), 'harassment') $$, 'P0002', null, 'bystander: a conversation they are not in is "not found"');

-- The moderator sees the queue, the evidence, and resolves; the row cannot be rewritten.
select pg_temp.act_as('a7a7a7a7-0000-4000-8000-000000000003');
select is((select jsonb_array_length(evidence) from reports where target_type = 'conversation'), 2, 'moderator: the conversation report carries the last messages');
update reports set state = 'actioned', resolution_note = 'removed' where target_type = 'comment';
select throws_ok($$ update reports set reason = 'spam' where target_type = 'comment' $$, '42501', null, 'moderator: can resolve a report, never rewrite what was reported');

select * from finish();
rollback;
