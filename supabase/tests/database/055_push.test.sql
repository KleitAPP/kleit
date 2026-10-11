-- Tests for migration 073 (push, the server half): the switch, each person's own setting, the
-- quiet hours, what reaches the outbox, bundling, and the sender's doors.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(17);

insert into auth.users (id, email) values
  ('abababab-0000-4000-8000-000000000001', 'push-owner@test.kleit'),
  ('abababab-0000-4000-8000-000000000002', 'push-fan@test.kleit'),
  ('abababab-0000-4000-8000-000000000003', 'push-quiet@test.kleit'),
  ('abababab-0000-4000-8000-000000000004', 'push-banned@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('abababab-0000-4000-8000-000000000001', 'pushowner', now(), 't'),
  ('abababab-0000-4000-8000-000000000002', 'pushfan', now(), 't'),
  ('abababab-0000-4000-8000-000000000003', 'pushquiet', now(), 't'),
  ('abababab-0000-4000-8000-000000000004', 'pushbanned', now(), 't');
select set_config('kleit.server_write', '1', true);
update profiles set banned_at = now() where user_id = 'abababab-0000-4000-8000-000000000004';
select set_config('kleit.server_write', '', true);

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 1. The switch exists and is off.
select is((select value::text from app_settings where key = 'push_open'), 'false', 'push_open exists and starts off');

-- 2. A person writes their own setting only; an unknown time zone becomes UTC.
select pg_temp.act_as('abababab-0000-4000-8000-000000000001');
select lives_ok($$ insert into push_settings (user_id, enabled, timezone, platform) values ('abababab-0000-4000-8000-000000000001', true, 'America/New_York', 'android') $$, 'owner: writes their own push setting');
select throws_ok($$ insert into push_settings (user_id, enabled) values ('abababab-0000-4000-8000-000000000002', true) $$, '42501', null, 'owner: cannot write someone else''s');
select throws_ok($$ select count(*) from push_queue $$, '42501', null, 'owner: cannot read the outbox');
select throws_ok($$ select * from claim_pushes(5) $$, '42501', null, 'owner: cannot claim from it');
reset role;
-- act_as leaves the claims behind for the transaction; the rest of this file is the server.
select set_config('request.jwt.claims', '', true);
insert into push_settings (user_id, enabled, timezone) values ('abababab-0000-4000-8000-000000000003', true, 'Not/AZone');
select is((select timezone from push_settings where user_id = 'abababab-0000-4000-8000-000000000003'), 'UTC', 'an unknown time zone becomes UTC');
insert into push_settings (user_id, enabled, timezone) values ('abababab-0000-4000-8000-000000000004', true, 'UTC');

-- 3. Quiet hours in the person's own zone (New York, in daylight time: UTC-4).
select is(private.push_due_at('abababab-0000-4000-8000-000000000001', '2026-10-10 03:00+00'), '2026-10-10 12:00+00'::timestamptz, '11 pm in New York waits for 8 am');
select is(private.push_due_at('abababab-0000-4000-8000-000000000001', '2026-10-10 10:00+00'), '2026-10-10 12:00+00'::timestamptz, '6 am in New York waits for 8 am');
select is(private.push_due_at('abababab-0000-4000-8000-000000000001', '2026-10-10 15:00+00'), '2026-10-10 15:00+00'::timestamptz, '11 am in New York goes at once');

-- 4. Nothing is queued while the switch is off.
insert into notifications (id, user_id, kind, actor_id, ref_type, ref_id) values
  ('abab0000-0000-4000-8000-000000000001', 'abababab-0000-4000-8000-000000000001', 'follow', 'abababab-0000-4000-8000-000000000002', 'profile', 'abababab-0000-4000-8000-000000000002');
select is((select count(*)::int from push_queue), 0, 'switch off: nothing reaches the outbox');

-- 5. Switch on: a new notification queues one push, with the actor's name for the sender.
--    (A comment: likes are in-app only since 078, and have their own test, 059.)
update app_settings set value = 'true' where key = 'push_open';
insert into notifications (id, user_id, kind, actor_id, ref_type, ref_id) values
  ('abab0000-0000-4000-8000-000000000002', 'abababab-0000-4000-8000-000000000001', 'comment', 'abababab-0000-4000-8000-000000000002', 'set', gen_random_uuid());
select is((select count(*)::int from push_queue where notification_id = 'abab0000-0000-4000-8000-000000000002' and state = 'pending'), 1, 'switch on: a comment queues one push');
-- A bundled comment within the hour does not queue another.
update notifications set bundled_count = bundled_count + 1 where id = 'abab0000-0000-4000-8000-000000000002';
update notifications set bundled_count = bundled_count + 1 where id = 'abab0000-0000-4000-8000-000000000002';
select is((select count(*)::int from push_queue where notification_id = 'abab0000-0000-4000-8000-000000000002'), 1, 'twelve comments in an hour are still one push');

-- 6. Nobody who has not said yes, and nobody hidden.
insert into notifications (user_id, kind, actor_id, ref_type, ref_id) values
  ('abababab-0000-4000-8000-000000000002', 'follow', 'abababab-0000-4000-8000-000000000001', 'profile', 'abababab-0000-4000-8000-000000000001');
select is((select count(*)::int from push_queue where user_id = 'abababab-0000-4000-8000-000000000002'), 0, 'no push setting: nothing queued');
insert into notifications (user_id, kind, actor_id, ref_type, ref_id) values
  ('abababab-0000-4000-8000-000000000004', 'follow', 'abababab-0000-4000-8000-000000000001', 'profile', 'abababab-0000-4000-8000-000000000001');
select is((select count(*)::int from push_queue where user_id = 'abababab-0000-4000-8000-000000000004'), 0, 'a banned account: nothing queued');

-- 7. The sender's doors, as the server: claim, then mark; a second claim finds nothing.
update push_queue set due_at = now() - interval '1 minute';
select set_config('role', 'service_role', true);
create temp table batch as select * from claim_pushes(100);
select is((select count(*)::int from batch), 1, 'server: claims the one due push');
select is((select actor_username from batch limit 1), 'pushfan', 'server: the claim carries the actor''s username');
select mark_pushes((select array_agg(id) from batch), 'sent');
select is((select count(*)::int from claim_pushes(100)), 0, 'server: a sent push is not claimed again');
reset role;

select * from finish();
rollback;
