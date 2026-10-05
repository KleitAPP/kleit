-- Tests for Ask (migration 033; roadmap M5.3 "Done when": an Ask can be answered with a set).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into auth.users (id, email) values
  ('afafafaf-0000-4000-8000-000000000001', 'asker@test.kleit'),
  ('afafafaf-0000-4000-8000-000000000002', 'answerer@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('afafafaf-0000-4000-8000-000000000001', 'asker', now(), 't'),
  ('afafafaf-0000-4000-8000-000000000002', 'answerer', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code) values
  ('85858585-0000-4000-8000-000000000001', 'afafafaf-0000-4000-8000-000000000002', 'public answer', 'published', 'public', 'askpublicset0001'),
  ('85858585-0000-4000-8000-000000000002', 'afafafaf-0000-4000-8000-000000000002', 'private one', 'published', 'only_me', 'askprivateset002');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act_as('afafafaf-0000-4000-8000-000000000001');
insert into ask_posts (id, author_id, question) values ('84848484-0000-4000-8000-000000000001', 'afafafaf-0000-4000-8000-000000000001', 'What goes with wide-leg jeans?');
select throws_ok($$ insert into ask_posts (author_id, question) values ('afafafaf-0000-4000-8000-000000000002', 'forged?') $$, '42501', null, 'asker: cannot ask in someone else''s name');

select pg_temp.act_as('afafafaf-0000-4000-8000-000000000002');
select is((select count(*)::int from ask_posts), 1, 'answerer: sees the open question');
select throws_ok($$ insert into ask_answers (ask_id, author_id, set_id) values ('84848484-0000-4000-8000-000000000001', 'afafafaf-0000-4000-8000-000000000002', '85858585-0000-4000-8000-000000000002') $$, '42501', null, 'answerer: cannot answer with an only-me set');
select throws_ok($$ insert into ask_answers (ask_id, author_id, set_id, chosen) values ('84848484-0000-4000-8000-000000000001', 'afafafaf-0000-4000-8000-000000000002', '85858585-0000-4000-8000-000000000001', true) $$, '42501', null, 'answerer: cannot arrive already chosen');
select lives_ok($$ insert into ask_answers (id, ask_id, author_id, set_id, body) values ('83838383-0000-4000-8000-000000000001', '84848484-0000-4000-8000-000000000001', 'afafafaf-0000-4000-8000-000000000002', '85858585-0000-4000-8000-000000000001', 'a boxy shirt') $$, 'answerer: answers with a public set');
select throws_ok($$ update ask_answers set chosen = true where id = '83838383-0000-4000-8000-000000000001' $$, '42501', null, 'answerer: cannot choose their own answer');

select pg_temp.act_as('afafafaf-0000-4000-8000-000000000001');
select is((select count(*)::int from ask_answers where ask_id = '84848484-0000-4000-8000-000000000001'), 1, 'asker: sees the answer');
select is((select count(*)::int from notifications where kind = 'ask_answer'), 1, 'asker: was told of the answer');
update ask_answers set chosen = true where id = '83838383-0000-4000-8000-000000000001';
select is((select chosen from ask_answers where id = '83838383-0000-4000-8000-000000000001'), true, 'asker: chose it');
update ask_posts set closed_at = now() where id = '84848484-0000-4000-8000-000000000001';
select pg_temp.act_as('afafafaf-0000-4000-8000-000000000002');
select is((select count(*)::int from notifications where kind = 'ask_chosen'), 1, 'answerer: was told their answer was chosen');
select throws_ok($$ insert into ask_answers (ask_id, author_id, set_id, body) values ('84848484-0000-4000-8000-000000000001', 'afafafaf-0000-4000-8000-000000000002', '85858585-0000-4000-8000-000000000001', 'late') $$, null, null, 'answerer: a closed question takes no more answers (and the same set twice never did)');

select * from finish();
rollback;
