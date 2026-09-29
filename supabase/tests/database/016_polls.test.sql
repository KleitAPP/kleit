-- Tests for migration 022 — polls (roadmap M3.7 "Done when": guests never touch the database,
-- a second vote from the same device is refused, the owner sees totals and no names).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(42);

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'pollowner@test.kleit'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'pollstranger@test.kleit'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'pollfriend@test.kleit'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'pollblocked@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'pollowner', now(), 't'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'pollstranger', now(), 't'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'pollfriend', now(), 't'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'pollblocked', now(), 't');
insert into follows (follower_id, followee_id) values
  ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000003');
insert into blocks (blocker_id, blocked_id) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000004');

-- The owner's sets: two public, one friends-only, one draft; and a stranger's public set.
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('66666666-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'A', 'published', 'public',  'pollsetA00000001'),
  ('66666666-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'B', 'published', 'public',  'pollsetB00000002'),
  ('66666666-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'C', 'published', 'friends', 'pollsetC00000003'),
  ('66666666-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001', 'D', 'draft',     'public',  'pollsetD00000004'),
  ('66666666-0000-4000-8000-000000000005', 'bbbbbbbb-0000-4000-8000-000000000001', 'E', 'published', 'public',  'pollsetE00000005'),
  ('66666666-0000-4000-8000-000000000006', 'bbbbbbbb-0000-4000-8000-000000000001', 'F', 'published', 'public',  'pollsetF00000006'),
  ('66666666-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000002', 'S', 'published', 'public',  'pollsetS00000009');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- The owner makes two polls: A+B (anyone can see both sets) and A+C (C is friends-only).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000001');
insert into polls (id, owner_id, question, share_code) values
  ('77777777-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'Which one?', 'pollcode00000001'),
  ('77777777-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'Friends only', 'pollcode00000002');
select lives_ok($$
  insert into poll_options (id, poll_id, set_id, label, sort_order) values
    ('88888888-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000001', 'Left', 0),
    ('88888888-0000-4000-8000-000000000002', '77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000002', 'Right', 1),
    ('88888888-0000-4000-8000-000000000011', '77777777-0000-4000-8000-000000000002', '66666666-0000-4000-8000-000000000001', 'A', 0),
    ('88888888-0000-4000-8000-000000000012', '77777777-0000-4000-8000-000000000002', '66666666-0000-4000-8000-000000000003', 'C', 1)
$$, 'owner: two published sets per poll go in');
select throws_ok($$
  insert into poll_options (poll_id, set_id, label, sort_order) values
    ('77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000004', 'draft', 2)
$$, '23514', 'only your own published sets can go in a poll', 'owner: a draft cannot go in');
select throws_ok($$
  insert into poll_options (poll_id, set_id, label, sort_order) values
    ('77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000009', 'theirs', 2)
$$, '23514', 'only your own published sets can go in a poll', 'owner: someone else''s set cannot go in');
select lives_ok($$
  insert into poll_options (poll_id, set_id, label, sort_order) values
    ('77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000005', 'E', 2),
    ('77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000006', 'F', 3)
$$, 'owner: up to four sets');
select throws_ok($$
  insert into poll_options (poll_id, set_id, label, sort_order) values
    ('77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000003', 'C', 3)
$$, '23514', 'a poll compares at most four sets', 'owner: a fifth set is refused');
delete from poll_options where set_id in ('66666666-0000-4000-8000-000000000005', '66666666-0000-4000-8000-000000000006');

select throws_ok($$ update polls set share_code = 'hacked0000000000' where id = '77777777-0000-4000-8000-000000000001' $$,
  '42501', null, 'owner: cannot change the share code');
select throws_ok($$ update polls set locked = true where id = '77777777-0000-4000-8000-000000000001' $$,
  '42501', null, 'owner: cannot lock by hand');
select lives_ok($$ update polls set question = 'Which one tonight?' where id = '77777777-0000-4000-8000-000000000001' $$,
  'owner: can change the question');
select throws_ok($$ select count(*) from votes $$, '42501', null, 'owner: cannot read the votes table at all');
select is((select count(*)::int from poll_totals where poll_id = '77777777-0000-4000-8000-000000000001'), 2,
  'owner: sees a totals row per option (zero votes)');

-- ---------------------------------------------------------------------------
-- Who can read which poll.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000002');
select is((select count(*)::int from polls where id = '77777777-0000-4000-8000-000000000001'), 1, 'stranger: sees the A+B poll');
select is((select count(*)::int from polls where id = '77777777-0000-4000-8000-000000000002'), 0, 'stranger: not the poll with a friends-only set');
select is((select count(*)::int from poll_options where poll_id = '77777777-0000-4000-8000-000000000002'), 0, 'stranger: nor its options');
select is((select count(*)::int from poll_totals where poll_id = '77777777-0000-4000-8000-000000000001'), 0, 'stranger: no totals before voting');
select throws_ok($$ insert into poll_options (poll_id, set_id, label, sort_order) values
  ('77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000009', 'mine', 2) $$,
  '23514', null, 'stranger: cannot add an option to someone else''s poll');
select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000003');
select is((select count(*)::int from polls where id = '77777777-0000-4000-8000-000000000002'), 1, 'friend: sees the poll with the friends-only set');
select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000004');
select is((select count(*)::int from polls where id = '77777777-0000-4000-8000-000000000001'), 0, 'blocked: sees no poll of the owner''s');

-- ---------------------------------------------------------------------------
-- The guest's view: the function, with the public key, and no totals in it.
-- ---------------------------------------------------------------------------
select pg_temp.anon();
select is((shared_poll('pollcode00000001') -> 'options') is not null and jsonb_array_length(shared_poll('pollcode00000001') -> 'options') = 2, true,
  'guest: the poll and its two options by code');
select is(shared_poll('pollcode00000001') ->> 'question', 'Which one tonight?', 'guest: the question');
select is(shared_poll('pollcode00000001') ? 'totals', false, 'guest: no totals before voting');
select is(shared_poll('wrongcode0000000'), null, 'guest: a wrong code is nothing');
select throws_ok($$ select count(*) from polls $$, '42501', null, 'guest: no table access');
select throws_ok($$ select record_vote('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', null, 'devicedevicedevice01', 'ip1') $$,
  '42501', null, 'guest: cannot call record_vote (server only)');
select pg_temp.back();

-- ---------------------------------------------------------------------------
-- Votes, as the server.
-- ---------------------------------------------------------------------------
select is((record_vote('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', null, 'devicedevicedevice01', 'ip1') ->> 'changed')::boolean, false,
  'server: a first vote lands');
select is((select locked from polls where id = '77777777-0000-4000-8000-000000000001'), true, 'server: the first vote locks the options');
select throws_ok($$ select record_vote('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', null, 'devicedevicedevice01', 'ip1') $$,
  'P0001', 'already_voted', 'server: the same device, same option again: refused');
select is((record_vote('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000002', null, 'devicedevicedevice01', 'ip1') ->> 'changed')::boolean, true,
  'server: the same device, other option: the vote changes');
select is((select count(*)::int from votes where poll_id = '77777777-0000-4000-8000-000000000001'), 1, 'server: still one vote for that device');
select throws_ok($$ select record_vote('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000004', 'devicedevicedevice04', 'ip4') $$,
  'P0001', 'blocked', 'server: a blocked person cannot vote');
select is(vote_status('77777777-0000-4000-8000-000000000001', 'devicedevicedevice01') ->> 'option_id', '88888888-0000-4000-8000-000000000002', 'server: vote_status knows the device''s vote');
select is(vote_status('77777777-0000-4000-8000-000000000001', 'devicedevicedevice99'), null, 'server: vote_status is null for a device that has not voted');

-- A network burst: 20 more devices from one address.
select lives_ok($$
  select record_vote('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', null, 'burstdevice000000' || lpad(i::text, 3, '0'), 'ipburst')
  from generate_series(1, 20) i
$$, 'server: twenty votes from one network go in');
select throws_ok($$ select record_vote('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', null, 'burstdevice000000021', 'ipburst') $$,
  'P0001', 'too_many_network', 'server: the twenty-first from that network is refused');
select is((select count(*)::int from votes where ip_hash = 'ipburst' and weight = 0.5), 15, 'server: past five, the burst''s votes weigh half');

-- Locked: the owner cannot touch the options or the deadline now.
select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000001');
select throws_ok($$ insert into poll_options (poll_id, set_id, label, sort_order) values
  ('77777777-0000-4000-8000-000000000001', '66666666-0000-4000-8000-000000000005', 'E', 2) $$,
  '42501', null, 'owner: no new option after the first vote');
select throws_ok($$ update polls set closes_at = now() + interval '20 days' where id = '77777777-0000-4000-8000-000000000001' $$,
  '42501', null, 'owner: the deadline is fixed after the first vote');
select is((select sum(raw_votes)::int from poll_totals where poll_id = '77777777-0000-4000-8000-000000000001'), 21, 'owner: totals count every vote');
select is((select round(sum(votes), 2) from poll_totals where poll_id = '77777777-0000-4000-8000-000000000001'), 13.50, 'owner: weighted totals down-weight the burst');
-- Reopen: the warning has been shown; the votes go and the options unlock.
select is(reopen_poll('77777777-0000-4000-8000-000000000001'), true, 'owner: reopen');
select is((select locked from polls where id = '77777777-0000-4000-8000-000000000001'), false, 'owner: reopened poll is unlocked');
select pg_temp.back();
select is((select count(*)::int from votes where poll_id = '77777777-0000-4000-8000-000000000001'), 0, 'server: reopening cleared the votes');

-- Closed by the owner: no more votes.
select pg_temp.act_as('bbbbbbbb-0000-4000-8000-000000000001');
update polls set closed_at = now() where id = '77777777-0000-4000-8000-000000000001';
select pg_temp.back();
select throws_ok($$ select record_vote('77777777-0000-4000-8000-000000000001', '88888888-0000-4000-8000-000000000001', null, 'devicedevicedevice05', 'ip5') $$,
  'P0001', 'closed', 'server: a closed poll takes no vote');

select * from finish();
rollback;
