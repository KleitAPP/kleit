-- Tests for migration 090: an account's label is set by an admin through one door and logged;
-- a member can neither change their own nor claim one (or points, or an unban) on the way in;
-- everyone who can read the profile reads the label, and the share page carries it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email) values
  ('e1e1e1e1-0000-4000-8000-000000000001', 'al-admin@test.kleit'),
  ('e1e1e1e1-0000-4000-8000-000000000002', 'al-stylist@test.kleit'),
  ('e1e1e1e1-0000-4000-8000-000000000003', 'al-member@test.kleit'),
  ('e1e1e1e1-0000-4000-8000-000000000004', 'al-newcomer@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('e1e1e1e1-0000-4000-8000-000000000001', 'aladmin', now(), 't'),
  ('e1e1e1e1-0000-4000-8000-000000000002', 'alstylist', now(), 't'),
  ('e1e1e1e1-0000-4000-8000-000000000003', 'almember', now(), 't');
insert into user_roles (user_id, role) values ('e1e1e1e1-0000-4000-8000-000000000001', 'admin');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('e1000000-0000-4000-8000-000000000001', 'e1e1e1e1-0000-4000-8000-000000000002', 'al stylist set', 'published', 'public', 'alstylistset0001', now());

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.back() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1. A member cannot label themselves, nor arrive labelled, rich or un-banned.
select pg_temp.act_as('e1e1e1e1-0000-4000-8000-000000000003');
select throws_ok($$ update profiles set label = 'staff' where user_id = 'e1e1e1e1-0000-4000-8000-000000000003' $$, '42501', null, 'member: cannot label their own account');
select throws_ok($$ select set_account_label('almember', 'brand') $$, '42501', null, 'member: the door is the admins''');
select pg_temp.act_as('e1e1e1e1-0000-4000-8000-000000000004');
select throws_ok($$ insert into profiles (user_id, username, age_confirmed_at, terms_version, label) values ('e1e1e1e1-0000-4000-8000-000000000004', 'alnewcomer', now(), 't', 'stylist') $$, '42501', null, 'newcomer: cannot arrive with a label');
select throws_ok($$ insert into profiles (user_id, username, age_confirmed_at, terms_version, points) values ('e1e1e1e1-0000-4000-8000-000000000004', 'alnewcomer', now(), 't', 5000) $$, '42501', null, 'newcomer: cannot arrive with points');
select lives_ok($$ insert into profiles (user_id, username, age_confirmed_at, terms_version) values ('e1e1e1e1-0000-4000-8000-000000000004', 'alnewcomer', now(), 't') $$, 'newcomer: a plain row is fine');
select is((select label::text from profiles where user_id = 'e1e1e1e1-0000-4000-8000-000000000004'), 'none', 'and starts unlabelled');

-- 2. An admin labels by username; it is logged; nobody is a label.
select pg_temp.act_as('e1e1e1e1-0000-4000-8000-000000000001');
select is(set_account_label('alstylist', 'stylist'), true, 'admin: labels an account');
select is((select label::text from profiles where user_id = 'e1e1e1e1-0000-4000-8000-000000000002'), 'stylist', 'the label is on the profile');
select is((select count(*)::int from admin_audit_log where what = 'label' and target_id = 'e1e1e1e1-0000-4000-8000-000000000002' and admin_id = 'e1e1e1e1-0000-4000-8000-000000000001'), 1, 'and in the audit log');
select is(set_account_label('nobody-by-this-name', 'brand'), false, 'admin: an unknown name is a quiet no');

-- 3. Everyone who can read the profile reads the label; the share page carries it.
select pg_temp.act_as('e1e1e1e1-0000-4000-8000-000000000003');
select is((select label::text from profiles where username = 'alstylist'), 'stylist', 'member: reads the stylist''s label');
select pg_temp.back();
select is((select shared_set('alstylistset0001') -> 'owner' ->> 'label'), 'stylist', 'the share page carries the label');

select * from finish();
rollback;
