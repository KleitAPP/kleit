-- Tests for deleting an account (migration 051; spec 3.7): hidden at once, seven days to undo,
-- then final with every promise kept.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('f3f3f3f3-0000-4000-8000-000000000001', 'leaver@test.kleit'),
  ('f3f3f3f3-0000-4000-8000-000000000002', 'stayer@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('f3f3f3f3-0000-4000-8000-000000000001', 'leaver', now(), 't'),
  ('f3f3f3f3-0000-4000-8000-000000000002', 'stayer', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('f3000000-0000-4000-8000-000000000001', 'f3f3f3f3-0000-4000-8000-000000000001', 'leaver set', 'published', 'public', 'leaverpublic0001', now()),
  ('f3000000-0000-4000-8000-000000000002', 'f3f3f3f3-0000-4000-8000-000000000002', 'remix of it', 'published', 'public', 'stayerremix00002', now());
update sets set remixed_from_set_id = 'f3000000-0000-4000-8000-000000000001' where id = 'f3000000-0000-4000-8000-000000000002';
insert into items (id, owner_id, kind, title) values
  ('f3000000-0000-4000-8000-000000000011', 'f3f3f3f3-0000-4000-8000-000000000001', 'product', 'a clipped coat'),
  ('f3000000-0000-4000-8000-000000000012', 'f3f3f3f3-0000-4000-8000-000000000001', 'own', 'my own photo');
insert into conversations (id, user_a, user_b) values ('f3000000-0000-4000-8000-000000000021', 'f3f3f3f3-0000-4000-8000-000000000001', 'f3f3f3f3-0000-4000-8000-000000000002');
insert into messages (id, conversation_id, sender_id, body) values ('f3000000-0000-4000-8000-000000000031', 'f3000000-0000-4000-8000-000000000021', 'f3f3f3f3-0000-4000-8000-000000000001', 'hello from the leaver');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Asking: hidden at once; the stayer sees neither the profile nor the set.
select pg_temp.act_as('f3f3f3f3-0000-4000-8000-000000000001');
select ok((select request_account_deletion()) > now() + interval '6 days', 'leaver: deletion asked, final in seven days');
select is((select state::text from account_deletions where user_id = 'f3f3f3f3-0000-4000-8000-000000000001'), 'pending', 'leaver: sees the pending row');
select throws_ok($$ update profiles set deactivated_at = null where user_id = 'f3f3f3f3-0000-4000-8000-000000000001' $$, 'P0005', null, 'leaver: a plain sign-in cannot quietly end the hiding while a deletion is pending');
select pg_temp.act_as('f3f3f3f3-0000-4000-8000-000000000002');
select is((select count(*)::int from profiles where username = 'leaver'), 0, 'stayer: the leaver''s profile is hidden');
select is((select count(*)::int from sets where id = 'f3000000-0000-4000-8000-000000000001'), 0, 'stayer: the leaver''s set is hidden');

-- Undo: everything is back.
select pg_temp.act_as('f3f3f3f3-0000-4000-8000-000000000001');
select is((select cancel_account_deletion()), true, 'leaver: undone');
select pg_temp.act_as('f3f3f3f3-0000-4000-8000-000000000002');
select is((select count(*)::int from sets where id = 'f3000000-0000-4000-8000-000000000001'), 1, 'stayer: the set is back');

-- Asked again, and the seven days pass: final.
select pg_temp.act_as('f3f3f3f3-0000-4000-8000-000000000001');
select request_account_deletion();
reset role; select set_config('request.jwt.claims', '', true);
update account_deletions set final_at = now() - interval '1 minute' where user_id = 'f3f3f3f3-0000-4000-8000-000000000001';
select is((select private.finalize_account_deletions()), 1, 'nightly: one account made final');
select is((select count(*)::int from auth.users where id = 'f3f3f3f3-0000-4000-8000-000000000001'), 0, 'the account itself is gone, so the username is free');
select is((select owner_id is null from items where id = 'f3000000-0000-4000-8000-000000000011'), true, 'the clipped store piece stays in the catalogue with no owner');
select is((select deleted_at is not null from items where id = 'f3000000-0000-4000-8000-000000000012'), true, 'their own photo is gone');
select is((select remixed_from_label from sets where id = 'f3000000-0000-4000-8000-000000000002'), 'Remixed from a deleted account', 'the stayer''s remix stays, credited to a deleted account');

select * from finish();
rollback;
