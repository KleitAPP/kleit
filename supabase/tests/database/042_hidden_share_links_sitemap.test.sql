-- Tests for migration 055: a hidden account's share links (set page and poll page) go dark -
-- on a break, suspended or waiting for deletion - and come back when the account does.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values ('e4e4e4e4-0000-4000-8000-000000000001', 'hidden-owner@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e4e4e4e4-0000-4000-8000-000000000001', 'hiddenowner', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('e4000000-0000-4000-8000-000000000001', 'e4e4e4e4-0000-4000-8000-000000000001', 'left', 'published', 'public', 'hiddenset0000001', now()),
  ('e4000000-0000-4000-8000-000000000002', 'e4e4e4e4-0000-4000-8000-000000000001', 'right', 'published', 'public', 'hiddenset0000002', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- The owner makes a poll of the two sets.
select pg_temp.act_as('e4e4e4e4-0000-4000-8000-000000000001');
insert into polls (id, owner_id, question, share_code) values
  ('e4000000-0000-4000-8000-000000000011', 'e4e4e4e4-0000-4000-8000-000000000001', 'Which one?', 'hiddenpoll000001');
insert into poll_options (poll_id, set_id, label, sort_order) values
  ('e4000000-0000-4000-8000-000000000011', 'e4000000-0000-4000-8000-000000000001', 'Left', 0),
  ('e4000000-0000-4000-8000-000000000011', 'e4000000-0000-4000-8000-000000000002', 'Right', 1);

-- A guest can open both while the account is live.
reset role;
select set_config('request.jwt.claims', '', true);
set role anon;
select is(shared_set('hiddenset0000001') ->> 'title', 'left', 'guest: the set page works while the owner is live');
select is(shared_poll('hiddenpoll000001') ->> 'question', 'Which one?', 'guest: the poll page works while the owner is live');
select is((select count(*)::int from public_set_codes() where share_code like 'hiddenset%'), 2, 'guest: both public sets are in the sitemap list');
reset role;
update sets set visibility = 'link' where id = 'e4000000-0000-4000-8000-000000000002';
set role anon;
select is((select count(*)::int from public_set_codes() where share_code like 'hiddenset%'), 1, 'guest: a link-only set leaves the sitemap list (its page still opens by code)');
select is(shared_set('hiddenset0000002') ->> 'title', 'right', 'guest: the link-only page still opens by code');
reset role;

-- On a break: both go dark.
update profiles set deactivated_at = now() where user_id = 'e4e4e4e4-0000-4000-8000-000000000001';
set role anon;
select is(shared_set('hiddenset0000001'), null, 'guest: the set page is gone while the owner is on a break (or deleting)');
select is(shared_poll('hiddenpoll000001'), null, 'guest: the poll page is gone too');
select is((select count(*)::int from public_set_codes() where share_code like 'hiddenset%'), 0, 'guest: and nothing of theirs is in the sitemap list');
reset role;

-- Back: both return.
update profiles set deactivated_at = null where user_id = 'e4e4e4e4-0000-4000-8000-000000000001';
set role anon;
select is(shared_set('hiddenset0000001') ->> 'title', 'left', 'guest: the set page returns when the owner does');
select is(shared_poll('hiddenpoll000001') ->> 'question', 'Which one?', 'guest: and the poll page');
reset role;

-- Suspended: dark again, for a signed-in stranger as much as a guest.
update profiles set banned_at = now() where user_id = 'e4e4e4e4-0000-4000-8000-000000000001';
set role anon;
select is(shared_set('hiddenset0000001'), null, 'guest: a suspended owner''s set page is gone');
select is(shared_poll('hiddenpoll000001'), null, 'guest: and their poll page');
reset role;

select * from finish();
rollback;
