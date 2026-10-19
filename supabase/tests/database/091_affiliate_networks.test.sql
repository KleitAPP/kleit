-- Tests for migration 116: a store's affiliate network is a row an admin writes, logged; the
-- server reads it by domain; nobody else writes it and only staff read it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(8);

insert into auth.users (id, email) values
  ('d3000000-0000-4000-8000-000000000001', 'an-admin@test.kleit'),
  ('d3000000-0000-4000-8000-000000000002', 'an-person@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('d3000000-0000-4000-8000-000000000001', 'anadmin', now(), 't'),
  ('d3000000-0000-4000-8000-000000000002', 'anperson', now(), 't');
insert into user_roles (user_id, role) values ('d3000000-0000-4000-8000-000000000001', 'admin');

create function pg_temp.act_as(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_server() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

select pg_temp.act_as('d3000000-0000-4000-8000-000000000002');
select throws_ok($$ select set_affiliate_network('www.Wombat.example', 'skimlinks', 'https://go.skimresources.com/?id=1&url={url}') $$, '42501', null, 'person: cannot set a network');
select throws_ok($$ insert into affiliate_networks (domain, network, link_template) values ('wombat.example', 'x', 'https://x/{url}') $$, '42501', null, 'person: cannot write the table');
select is((select count(*) from affiliate_networks), 0::bigint, 'person: and reads nothing');
select pg_temp.act_as('d3000000-0000-4000-8000-000000000001');
select lives_ok($$ select set_affiliate_network('www.Wombat.example', 'skimlinks', 'https://go.skimresources.com/?id=1&url={url}', true, 'test') $$, 'admin: sets a network');
select throws_ok($$ select set_affiliate_network('other.example', 'skimlinks', 'http://insecure/{url}') $$, '23514', null, 'admin: a template must be https and carry the store address');
select pg_temp.as_server();
select is((select network from affiliate_for('WWW.wombat.example')), 'skimlinks', 'server: finds it by domain, whatever the case or www');
select is((select count(*) from admin_audit_log where what = 'network' and reason like 'wombat.example%'), 1::bigint, 'the change is logged');
select pg_temp.act_as('d3000000-0000-4000-8000-000000000001');
select lives_ok($$ select set_affiliate_network('wombat.example', 'skimlinks', 'https://go.skimresources.com/?id=1&url={url}', false) $$, 'admin: switches it off');

select * from finish();
rollback;
