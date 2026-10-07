-- Tests for the nightly cleanup (migration 049; roadmap M7.6 "Done when": the cleanup job
-- enforces every retention period in spec 14.2). Old rows go or are blanked; fresh ones stay.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values ('d1d1d1d1-0000-4000-8000-000000000001', 'cleanup@test.kleit'), ('d1d1d1d1-0000-4000-8000-000000000002', 'cleanup2@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values ('d1d1d1d1-0000-4000-8000-000000000001', 'cleanup', now(), 't'), ('d1d1d1d1-0000-4000-8000-000000000002', 'cleanuptwo', now(), 't');
insert into sets (id, owner_id, title, status, share_code, deleted_at) values
  ('d1000000-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000001', 'old bin', 'draft', 'cleanupoldbin001', now() - interval '31 days'),
  ('d1000000-0000-4000-8000-000000000002', 'd1d1d1d1-0000-4000-8000-000000000001', 'fresh bin', 'draft', 'cleanupfreshbn02', now() - interval '2 days');
insert into items (id, owner_id, kind, title) values ('d1000000-0000-4000-8000-000000000011', 'd1d1d1d1-0000-4000-8000-000000000001', 'own', 'clicked piece');
insert into clicks (item_id, network, created_at) values
  ('d1000000-0000-4000-8000-000000000011', 'direct', now() - interval '100 days'),
  ('d1000000-0000-4000-8000-000000000011', 'direct', now() - interval '100 days'),
  ('d1000000-0000-4000-8000-000000000011', 'direct', now() - interval '1 day');
insert into notifications (user_id, kind, read_at, created_at) values
  ('d1d1d1d1-0000-4000-8000-000000000001', 'like', now() - interval '91 days', now() - interval '92 days'),
  ('d1d1d1d1-0000-4000-8000-000000000001', 'like', null, now() - interval '92 days');
insert into conversations (id, user_a, user_b) values ('d1000000-0000-4000-8000-000000000021', 'd1d1d1d1-0000-4000-8000-000000000001', 'd1d1d1d1-0000-4000-8000-000000000002');
insert into messages (id, conversation_id, sender_id, body, deleted_at) values
  ('d1000000-0000-4000-8000-000000000031', 'd1000000-0000-4000-8000-000000000021', 'd1d1d1d1-0000-4000-8000-000000000001', 'taken back long ago', now() - interval '31 days'),
  ('d1000000-0000-4000-8000-000000000032', 'd1000000-0000-4000-8000-000000000021', 'd1d1d1d1-0000-4000-8000-000000000001', 'taken back yesterday', now() - interval '1 day');

select private.nightly_cleanup();

select is((select count(*)::int from sets where id = 'd1000000-0000-4000-8000-000000000001'), 0, 'a set in the bin for 31 days is gone for good');
select is((select count(*)::int from sets where id = 'd1000000-0000-4000-8000-000000000002'), 1, 'a set in the bin for 2 days stays (restorable)');
select is((select count(*)::int from clicks where item_id = 'd1000000-0000-4000-8000-000000000011'), 1, 'clicks older than 90 days are gone; the fresh one stays');
select is((select clicks from click_totals where item_id = 'd1000000-0000-4000-8000-000000000011'), 2, 'the old clicks became one count per item per day');
select is((select count(*)::int from notifications where user_id = 'd1d1d1d1-0000-4000-8000-000000000001'), 1, 'a notification read 91 days ago is gone; an unread one stays');
select is((select body from messages where id = 'd1000000-0000-4000-8000-000000000031'), ' ', 'a message taken back 31 days ago has no words left');
select is((select body from messages where id = 'd1000000-0000-4000-8000-000000000032'), 'taken back yesterday', 'a message taken back yesterday keeps its words for now');
select is((select private.nightly_cleanup() ->> 'sets')::int, 0, 'run twice: nothing more to do');

select * from finish();
rollback;
