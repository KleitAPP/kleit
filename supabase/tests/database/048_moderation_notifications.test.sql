-- Tests for migration 064: a reporter is told their report was reviewed, a struck person is told
-- of the strike, an appellant of the decision; the word list's own reports tell nobody.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

insert into auth.users (id, email) values
  ('eaeaeaea-0000-4000-8000-000000000001', 'mn-owner@test.kleit'),
  ('eaeaeaea-0000-4000-8000-000000000002', 'mn-reporter@test.kleit'),
  ('eaeaeaea-0000-4000-8000-000000000003', 'mn-moderator@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('eaeaeaea-0000-4000-8000-000000000001', 'mnowner', now(), 't'),
  ('eaeaeaea-0000-4000-8000-000000000002', 'mnreporter', now(), 't'),
  ('eaeaeaea-0000-4000-8000-000000000003', 'mnmoderator', now(), 't');
insert into user_roles (user_id, role) values ('eaeaeaea-0000-4000-8000-000000000003', 'moderator');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('ea000000-0000-4000-8000-000000000001', 'eaeaeaea-0000-4000-8000-000000000001', 'reported set', 'published', 'public', 'modnotify0000001', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.notes(uid uuid, k text) returns integer language sql security definer as $$
  select count(*)::int from public.notifications where user_id = uid and kind = k
$$;

-- A report, a strike for it: the reporter and the struck person each hear once.
select pg_temp.act_as('eaeaeaea-0000-4000-8000-000000000002');
select lives_ok($$ select file_report('set', 'ea000000-0000-4000-8000-000000000001', 'harassment', 'x') $$, 'reporter: files');
select pg_temp.act_as('eaeaeaea-0000-4000-8000-000000000003');
select lives_ok($$ select moderate((select id from reports where target_id = 'ea000000-0000-4000-8000-000000000001'), 'strike', 'x') $$, 'moderator: strikes');
select is(pg_temp.notes('eaeaeaea-0000-4000-8000-000000000002', 'report_resolved'), 1, 'reporter: is told the report was reviewed');
select is(pg_temp.notes('eaeaeaea-0000-4000-8000-000000000001', 'strike'), 1, 'owner: is told of the strike');

-- An appeal, overturned: the appellant hears.
select pg_temp.act_as('eaeaeaea-0000-4000-8000-000000000001');
insert into appeals (strike_id, user_id, body) values ((select id from strikes where user_id = 'eaeaeaea-0000-4000-8000-000000000001'), 'eaeaeaea-0000-4000-8000-000000000001', 'please');
select pg_temp.act_as('eaeaeaea-0000-4000-8000-000000000003');
select lives_ok($$ select decide_appeal((select id from appeals where user_id = 'eaeaeaea-0000-4000-8000-000000000001'), 'overturned', 'fair') $$, 'moderator: overturns');
select is(pg_temp.notes('eaeaeaea-0000-4000-8000-000000000001', 'appeal_decided'), 1, 'owner: is told the appeal was decided');

select * from finish();
rollback;
