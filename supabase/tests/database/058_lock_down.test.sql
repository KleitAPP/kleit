-- Tests for migration 077: Lock down (every set Only me with a new code, every open poll closed,
-- nobody else's touched) and "make all my sets link-only" (Public → Link-only, nothing else).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('dede0000-0000-4000-8000-000000000001', 'lock-owner@test.kleit'),
  ('dede0000-0000-4000-8000-000000000002', 'lock-other@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('dede0000-0000-4000-8000-000000000001', 'lockowner', now(), 't'),
  ('dede0000-0000-4000-8000-000000000002', 'lockother', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, deleted_at) values
  ('de000000-0000-4000-8000-000000000001', 'dede0000-0000-4000-8000-000000000001', 'public one', 'published', 'public', 'lockpublic000001', now(), null),
  ('de000000-0000-4000-8000-000000000002', 'dede0000-0000-4000-8000-000000000001', 'link one', 'published', 'link', 'locklink00000002', now(), null),
  ('de000000-0000-4000-8000-000000000003', 'dede0000-0000-4000-8000-000000000001', 'followers one', 'published', 'followers', 'lockfollow000003', now(), null),
  ('de000000-0000-4000-8000-000000000004', 'dede0000-0000-4000-8000-000000000001', 'a draft', 'draft', 'public', 'lockdraft0000004', null, null),
  ('de000000-0000-4000-8000-000000000005', 'dede0000-0000-4000-8000-000000000001', 'in the bin', 'published', 'public', 'lockbinned000005', now(), now() - interval '1 day'),
  ('de000000-0000-4000-8000-000000000011', 'dede0000-0000-4000-8000-000000000002', 'other public', 'published', 'public', 'lockotherpub0011', now(), null);
insert into polls (id, owner_id, share_code, question, closes_at) values
  ('de000000-0000-4000-8000-000000000021', 'dede0000-0000-4000-8000-000000000001', 'lockpoll00000021', 'Which?', now() + interval '3 days'),
  ('de000000-0000-4000-8000-000000000022', 'dede0000-0000-4000-8000-000000000002', 'lockpoll00000022', 'Which?', now() + interval '3 days');
insert into poll_options (poll_id, set_id, label, sort_order) values
  ('de000000-0000-4000-8000-000000000021', 'de000000-0000-4000-8000-000000000001', 'A', 1),
  ('de000000-0000-4000-8000-000000000021', 'de000000-0000-4000-8000-000000000002', 'B', 2),
  ('de000000-0000-4000-8000-000000000022', 'de000000-0000-4000-8000-000000000011', 'A', 1);

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Lock down, as the owner.
select pg_temp.act_as('dede0000-0000-4000-8000-000000000001');
select is(lock_down(), 4, 'owner: lock down touches every live set of theirs (the draft too), not the one in the bin');
reset role; select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from sets where owner_id = 'dede0000-0000-4000-8000-000000000001' and deleted_at is null and visibility <> 'only_me'), 0, 'every live set is Only me');
select is((select count(*)::int from sets where share_code in ('lockpublic000001', 'locklink00000002', 'lockfollow000003', 'lockdraft0000004')), 0, 'every old link is dead: all four codes are new');
select is((select share_code from sets where id = 'de000000-0000-4000-8000-000000000005'), 'lockbinned000005', 'the set in the bin keeps its code (it is not reachable anyway)');
select ok((select closed_at is not null from polls where id = 'de000000-0000-4000-8000-000000000021'), 'the owner''s open poll is closed');
select is((select visibility::text from sets where id = 'de000000-0000-4000-8000-000000000011'), 'public', 'someone else''s set is untouched');
select ok((select closed_at is null from polls where id = 'de000000-0000-4000-8000-000000000022'), 'someone else''s poll stays open');
select is((select count(*)::int from sets where owner_id = 'dede0000-0000-4000-8000-000000000001'), 5, 'nothing was deleted');

-- Make all link-only, as the other person (one Public set) and as the owner (none left).
select pg_temp.act_as('dede0000-0000-4000-8000-000000000002');
select is(make_all_link_only(), 1, 'other: their one Public set becomes Link-only');
reset role; select set_config('request.jwt.claims', '', true);
select is((select visibility::text from sets where id = 'de000000-0000-4000-8000-000000000011'), 'link', 'other: Link-only, with the code kept');
select pg_temp.act_as('dede0000-0000-4000-8000-000000000001');
select is(make_all_link_only(), 0, 'owner: nothing Public is left to change, and Only me sets are not widened');

select * from finish();
rollback;
