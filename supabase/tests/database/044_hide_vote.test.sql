-- Tests for migration 058: the poll owner sees votes one by one with nothing that names anyone,
-- hides one and the totals follow; a stranger sees and changes nothing.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values
  ('e6e6e6e6-0000-4000-8000-000000000001', 'hv-owner@test.kleit'),
  ('e6e6e6e6-0000-4000-8000-000000000002', 'hv-stranger@test.kleit'),
  ('e6e6e6e6-0000-4000-8000-000000000003', 'hv-voter@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e6e6e6e6-0000-4000-8000-000000000001', 'hvowner', now(), 't'),
  ('e6e6e6e6-0000-4000-8000-000000000002', 'hvstranger', now(), 't'),
  ('e6e6e6e6-0000-4000-8000-000000000003', 'hvvoter', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('e6000000-0000-4000-8000-000000000001', 'e6e6e6e6-0000-4000-8000-000000000001', 'a', 'published', 'public', 'hidevoteset00001', now()),
  ('e6000000-0000-4000-8000-000000000002', 'e6e6e6e6-0000-4000-8000-000000000001', 'b', 'published', 'public', 'hidevoteset00002', now());
insert into polls (id, owner_id, question, share_code) values
  ('e6000000-0000-4000-8000-000000000011', 'e6e6e6e6-0000-4000-8000-000000000001', 'Which?', 'hidevotepoll0001');
insert into poll_options (id, poll_id, set_id, label, sort_order) values
  ('e6000000-0000-4000-8000-000000000021', 'e6000000-0000-4000-8000-000000000011', 'e6000000-0000-4000-8000-000000000001', 'A', 0),
  ('e6000000-0000-4000-8000-000000000022', 'e6000000-0000-4000-8000-000000000011', 'e6000000-0000-4000-8000-000000000002', 'B', 1);
-- Three votes as the server would write them: a guest, a down-weighted guest, a signed-in person.
insert into votes (id, poll_id, option_id, voter_id, device_hash, ip_hash, weight) values
  ('e6000000-0000-4000-8000-000000000031', 'e6000000-0000-4000-8000-000000000011', 'e6000000-0000-4000-8000-000000000021', null, 'dev-one', 'net-one', 1),
  ('e6000000-0000-4000-8000-000000000032', 'e6000000-0000-4000-8000-000000000011', 'e6000000-0000-4000-8000-000000000021', null, 'dev-two', 'net-one', 0.5),
  ('e6000000-0000-4000-8000-000000000033', 'e6000000-0000-4000-8000-000000000011', 'e6000000-0000-4000-8000-000000000022', 'e6e6e6e6-0000-4000-8000-000000000003', 'dev-three', 'net-two', 1);

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The owner.
select pg_temp.act_as('e6e6e6e6-0000-4000-8000-000000000001');
select is((select count(*)::int from my_poll_votes('e6000000-0000-4000-8000-000000000011')), 3, 'owner: sees three votes');
select is((select weight from my_poll_votes('e6000000-0000-4000-8000-000000000011') where id = 'e6000000-0000-4000-8000-000000000032'), 0.5, 'owner: sees that one was counted at half');
select ok((select signed_in from my_poll_votes('e6000000-0000-4000-8000-000000000011') where id = 'e6000000-0000-4000-8000-000000000033'), 'owner: sees that one voter was signed in - and nothing more about them');
select is((select votes from poll_totals where option_id = 'e6000000-0000-4000-8000-000000000021'), 1.5, 'owner: option A counts 1.5 before hiding');
select lives_ok($$ select hide_vote('e6000000-0000-4000-8000-000000000032', true) $$, 'owner: hides the half vote');
select is((select votes from poll_totals where option_id = 'e6000000-0000-4000-8000-000000000021'), 1.0, 'owner: option A counts 1.0 after hiding');
select lives_ok($$ select hide_vote('e6000000-0000-4000-8000-000000000032', false) $$, 'owner: puts it back');

-- A stranger.
select pg_temp.act_as('e6e6e6e6-0000-4000-8000-000000000002');
select is((select count(*)::int from my_poll_votes('e6000000-0000-4000-8000-000000000011')), 0, 'stranger: sees no votes of a poll that is not theirs');
select throws_ok($$ select hide_vote('e6000000-0000-4000-8000-000000000031', true) $$, '42501', null, 'stranger: cannot hide a vote on someone else''s poll');

select * from finish();
rollback;
