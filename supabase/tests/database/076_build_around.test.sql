-- Tests for migration 100: a "build around this piece" question locks a cleared store piece,
-- only; an answer to it carries the piece; the lock cannot be moved; a plain question is as it was.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values
  ('ba000000-0000-4000-8000-000000000001', 'ba-asker@test.kleit'),
  ('ba000000-0000-4000-8000-000000000002', 'ba-friend@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('ba000000-0000-4000-8000-000000000001', 'baasker', now(), 't'),
  ('ba000000-0000-4000-8000-000000000002', 'bafriend', now(), 't');
-- A cleared store piece, one still being checked, and a piece of the asker's own.
insert into items (id, owner_id, kind, title, source_url, source_domain) values
  ('ba000000-0000-4000-8000-000000000011', 'ba000000-0000-4000-8000-000000000001', 'product', 'ba cleared boots', 'https://shop.example.com/boots', 'shop.example.com'),
  ('ba000000-0000-4000-8000-000000000012', 'ba000000-0000-4000-8000-000000000001', 'product', 'ba pending bag', 'https://shop.example.com/bag', 'shop.example.com'),
  ('ba000000-0000-4000-8000-000000000013', 'ba000000-0000-4000-8000-000000000001', 'own', 'ba own scarf', null, null);
insert into item_flags (item_id, scan_state, scanned_at) values
  ('ba000000-0000-4000-8000-000000000011', 'clean', now()),
  ('ba000000-0000-4000-8000-000000000013', 'clean', now());
-- The friend's two public sets: one with the boots on it, one without.
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ba000000-0000-4000-8000-000000000021', 'ba000000-0000-4000-8000-000000000002', 'with boots', 'published', 'public', 'bawithboots00001', now()),
  ('ba000000-0000-4000-8000-000000000022', 'ba000000-0000-4000-8000-000000000002', 'without', 'published', 'public', 'bawithout000001', now());
insert into set_items (set_id, item_id, position) values
  ('ba000000-0000-4000-8000-000000000021', 'ba000000-0000-4000-8000-000000000011', '{"slot": 0}');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- 1. The asker locks a cleared store piece; nothing else.
select pg_temp.act_as('ba000000-0000-4000-8000-000000000001');
select lives_ok($$ insert into ask_posts (id, author_id, question, item_id) values ('ba000000-0000-4000-8000-000000000031', 'ba000000-0000-4000-8000-000000000001', 'Build around this: boots', 'ba000000-0000-4000-8000-000000000011') $$, 'a cleared store piece can be locked');
select throws_ok($$ insert into ask_posts (author_id, question, item_id) values ('ba000000-0000-4000-8000-000000000001', 'Build around this: bag', 'ba000000-0000-4000-8000-000000000012') $$, '42501', null, 'a piece still being checked cannot');
select throws_ok($$ insert into ask_posts (author_id, question, item_id) values ('ba000000-0000-4000-8000-000000000001', 'Build around this: scarf', 'ba000000-0000-4000-8000-000000000013') $$, '42501', null, 'a piece of your own cannot (nobody else could place it)');
select throws_ok($$ insert into ask_posts (author_id, question, item_id) values ('ba000000-0000-4000-8000-000000000001', 'Build around this: ?', 'ba000000-0000-4000-8000-0000000000ff') $$, '42501', null, 'a piece that does not exist cannot');
select lives_ok($$ insert into ask_posts (id, author_id, question) values ('ba000000-0000-4000-8000-000000000032', 'ba000000-0000-4000-8000-000000000001', 'What goes with wide jeans?') $$, 'a plain question is as it was');

-- 2. The lock is set once.
select throws_ok($$ update ask_posts set item_id = null where id = 'ba000000-0000-4000-8000-000000000031' $$, '42501', null, 'the asker cannot move or clear the lock');

-- 3. An answer carries the piece.
select pg_temp.act_as('ba000000-0000-4000-8000-000000000002');
select throws_ok($$ insert into ask_answers (ask_id, author_id, set_id) values ('ba000000-0000-4000-8000-000000000031', 'ba000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000022') $$, '42501', null, 'a set without the piece cannot answer a build-around');
select lives_ok($$ insert into ask_answers (ask_id, author_id, set_id) values ('ba000000-0000-4000-8000-000000000031', 'ba000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000021') $$, 'a set with the piece on it can');
select lives_ok($$ insert into ask_answers (ask_id, author_id, set_id) values ('ba000000-0000-4000-8000-000000000032', 'ba000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000022') $$, 'a plain question takes any public set, as before');

select * from finish();
rollback;
