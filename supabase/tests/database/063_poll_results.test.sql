-- Tests for migration 084: the owner is told once when a poll with votes closes; a poll with no
-- votes, or still open, tells nothing.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

insert into auth.users (id, email) values ('afafafaf-0000-4000-8000-000000000001', 'pr-owner@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values ('afafafaf-0000-4000-8000-000000000001', 'prowner', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('af000000-0000-4000-8000-000000000001', 'afafafaf-0000-4000-8000-000000000001', 'a', 'published', 'public', 'prsetaaaaaaaa001', now()),
  ('af000000-0000-4000-8000-000000000002', 'afafafaf-0000-4000-8000-000000000001', 'b', 'published', 'public', 'prsetbbbbbbbb002', now());
-- Three polls: closed by the clock with a vote; closed with no votes; still open with a vote.
insert into polls (id, owner_id, share_code, question, created_at, closes_at) values
  ('af000000-0000-4000-8000-000000000011', 'afafafaf-0000-4000-8000-000000000001', 'prpollclosed0011', 'closed?', now() - interval '2 days', now() - interval '1 hour'),
  ('af000000-0000-4000-8000-000000000012', 'afafafaf-0000-4000-8000-000000000001', 'prpollempty00012', 'empty?', now() - interval '2 days', now() - interval '1 hour'),
  ('af000000-0000-4000-8000-000000000013', 'afafafaf-0000-4000-8000-000000000001', 'prpollopen000013', 'open?', now(), now() + interval '2 days');
insert into poll_options (id, poll_id, set_id, label, sort_order) values
  ('af000000-0000-4000-8000-000000000021', 'af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000001', 'A', 0),
  ('af000000-0000-4000-8000-000000000022', 'af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000002', 'B', 1),
  ('af000000-0000-4000-8000-000000000023', 'af000000-0000-4000-8000-000000000013', 'af000000-0000-4000-8000-000000000001', 'A', 0),
  ('af000000-0000-4000-8000-000000000024', 'af000000-0000-4000-8000-000000000013', 'af000000-0000-4000-8000-000000000002', 'B', 1);
insert into votes (poll_id, option_id, device_hash, ip_hash) values
  ('af000000-0000-4000-8000-000000000011', 'af000000-0000-4000-8000-000000000021', 'dev1', 'ip1'),
  ('af000000-0000-4000-8000-000000000013', 'af000000-0000-4000-8000-000000000023', 'dev2', 'ip2');

-- The live project has polls of its own; the counts here are about this file's polls only.
select ok(private.tell_poll_results() >= 1, 'the poll closed by the clock, with a vote, is due');
select is((select count(*)::int from notifications where kind = 'poll_results' and ref_id = 'af000000-0000-4000-8000-000000000011'), 1, 'the owner is told');
select is((select count(*)::int from notifications where kind = 'poll_results' and ref_id in ('af000000-0000-4000-8000-000000000012', 'af000000-0000-4000-8000-000000000013')), 0, 'an empty poll and an open poll tell nothing');
select is(private.tell_poll_results(), 0, 'run again: nobody is told twice');
update polls set closed_at = now() where id = 'af000000-0000-4000-8000-000000000013';
select ok(private.tell_poll_results() >= 1 and (select count(*) from notifications where kind = 'poll_results' and ref_id = 'af000000-0000-4000-8000-000000000013') = 1, 'closed by hand: told at the next tick');

select * from finish();
rollback;
