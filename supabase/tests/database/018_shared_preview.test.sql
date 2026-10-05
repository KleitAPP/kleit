-- Tests for migration 023 — the shared page carries the chat picture's path (CL30), and a poll
-- page carries it only for a set the world may see.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(4);

insert into auth.users (id, email) values ('dddddddd-0000-4000-8000-000000000001', 'previewowner@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('dddddddd-0000-4000-8000-000000000001', 'previewowner', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, preview_image_id) values
  ('97979797-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'pictured', 'published', 'public', 'prevcode00000001', '97979797-0000-4000-8000-000000000001/1.jpg'),
  ('97979797-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001', 'hidden',   'published', 'friends', 'prevcode00000002', '97979797-0000-4000-8000-000000000002/1.jpg');
insert into polls (id, owner_id, question, share_code) values
  ('96969696-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'which', 'prevpoll00000001');
insert into poll_options (poll_id, set_id, label, sort_order) values
  ('96969696-0000-4000-8000-000000000001', '97979797-0000-4000-8000-000000000001', 'a', 0),
  ('96969696-0000-4000-8000-000000000001', '97979797-0000-4000-8000-000000000002', 'b', 1);

set role anon;
select is(shared_set('prevcode00000001') ->> 'preview', '97979797-0000-4000-8000-000000000001/1.jpg', 'guest: the shared page knows the picture');
select is(shared_set('prevcode00000002'), null, 'guest: a friends-only set is still not shared at all');
select is(shared_poll('prevpoll00000001') -> 'options' -> 0 -> 'set' ->> 'preview', '97979797-0000-4000-8000-000000000001/1.jpg', 'guest: the poll page carries the public set''s picture');
select is(shared_poll('prevpoll00000001') -> 'options' -> 1 -> 'set' ->> 'preview', null, 'guest: and no picture for the friends-only set in it');
reset role;

select * from finish();
rollback;
