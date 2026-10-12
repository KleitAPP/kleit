-- Tests for migration 089: the Monday theme closes on Friday (four days); the weekly recap
-- shows the challenge that just closed (picks first, then the top three by likes), the
-- most-liked public remix of the week as the caller may see it, and the caller's own week.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('d9d9d9d9-0000-4000-8000-000000000001', 'wr-a@test.kleit'),
  ('d9d9d9d9-0000-4000-8000-000000000002', 'wr-b@test.kleit'),
  ('d9d9d9d9-0000-4000-8000-000000000003', 'wr-c@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('d9d9d9d9-0000-4000-8000-000000000001', 'wra', now(), 't'),
  ('d9d9d9d9-0000-4000-8000-000000000002', 'wrb', now(), 't'),
  ('d9d9d9d9-0000-4000-8000-000000000003', 'wrc', now(), 't');
insert into follows (follower_id, followee_id) values ('d9d9d9d9-0000-4000-8000-000000000003', 'd9d9d9d9-0000-4000-8000-000000000002');
-- Nothing else open or freshly closed for the length of the transaction.
update contests set closes_at = now() - interval '30 days', opens_at = now() - interval '37 days' where closes_at > now() - interval '7 days';
update contest_themes set used_at = now() where used_at is null;
insert into sets (id, owner_id, title, status, visibility, share_code, published_at, preview_image_id, remixed_from_set_id, remixed_from_label) values
  ('d9000000-0000-4000-8000-000000000001', 'd9d9d9d9-0000-4000-8000-000000000001', 'wr entry a', 'published', 'public', 'wrentrya00000001', now() - interval '3 days', 'wr/a.jpg', null, null),
  ('d9000000-0000-4000-8000-000000000002', 'd9d9d9d9-0000-4000-8000-000000000002', 'wr entry b', 'published', 'public', 'wrentryb00000001', now() - interval '3 days', 'wr/b.jpg', null, null),
  ('d9000000-0000-4000-8000-000000000003', 'd9d9d9d9-0000-4000-8000-000000000001', 'wr remix', 'published', 'public', 'wrremix000000001', now() - interval '2 days', 'wr/r.jpg', 'd9000000-0000-4000-8000-000000000002', 'Remixed from @wrb'),
  ('d9000000-0000-4000-8000-000000000004', 'd9d9d9d9-0000-4000-8000-000000000001', 'wr private remix', 'published', 'only_me', 'wrremixprivate01', now() - interval '2 days', 'wr/p.jpg', 'd9000000-0000-4000-8000-000000000002', 'Remixed from @wrb'),
  ('d9000000-0000-4000-8000-000000000005', 'd9d9d9d9-0000-4000-8000-000000000003', 'wr old remix', 'published', 'public', 'wrremixold000001', now() - interval '20 days', 'wr/o.jpg', 'd9000000-0000-4000-8000-000000000002', 'Remixed from @wrb');
insert into contests (id, title, opens_at, closes_at) values
  ('d9000000-0000-4000-8000-000000000011', 'WR week (ignore)', now() - interval '5 days', now() - interval '1 day');
insert into contest_entries (contest_id, user_id, set_id, picked_at) values
  ('d9000000-0000-4000-8000-000000000011', 'd9d9d9d9-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001', now() - interval '1 hour'),
  ('d9000000-0000-4000-8000-000000000011', 'd9d9d9d9-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000002', null);
-- Likes this week: two on b's entry, one on the public remix, three on the private one, one on the old one.
insert into likes (user_id, set_id, created_at) values
  ('d9d9d9d9-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000002', now() - interval '2 days'),
  ('d9d9d9d9-0000-4000-8000-000000000003', 'd9000000-0000-4000-8000-000000000002', now() - interval '2 days'),
  ('d9d9d9d9-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000003', now() - interval '1 day'),
  ('d9d9d9d9-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000004', now() - interval '1 day'),
  ('d9d9d9d9-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000004', now() - interval '1 day'),
  ('d9d9d9d9-0000-4000-8000-000000000003', 'd9000000-0000-4000-8000-000000000004', now() - interval '1 day'),
  ('d9d9d9d9-0000-4000-8000-000000000002', 'd9000000-0000-4000-8000-000000000005', now() - interval '1 day');

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

-- 1. The Monday theme closes on Friday.
insert into contest_themes (id, title, theme, position) values ('d9000000-0000-4000-8000-000000000021', 'WR theme (ignore)', 'x', -1);
select isnt((select private.open_weekly_contest()), null, 'monday: a theme opens');
select is((select closes_at - opens_at from contests where title = 'WR theme (ignore)'), interval '4 days', 'and closes four days later - Friday');
update contests set closes_at = now() - interval '30 days', opens_at = now() - interval '37 days' where title = 'WR theme (ignore)';

-- 2. The recap, as the viewer who follows nobody's week but their own (the answer is kept
--    where both roles can read it, the way 064 does).
create temp table wr (r jsonb);
grant all on wr to authenticated;
select pg_temp.act_as('d9d9d9d9-0000-4000-8000-000000000003');
insert into wr select weekly_recap();
select is((select (r->>'show')::boolean from wr), true, 'the weekend after a close: the recap shows');
select is((select r->'contest'->>'id' from wr), 'd9000000-0000-4000-8000-000000000011', 'the challenge that just closed');
select is((select (r->'contest'->>'entries')::int from wr), 2, 'with its entry count');
select is((select r->'contest'->'picks'->0->>'set_id' from wr), 'd9000000-0000-4000-8000-000000000001', 'the pick comes first');
select is((select r->'contest'->'top'->0->>'set_id' from wr), 'd9000000-0000-4000-8000-000000000002', 'the top of the board is the most-liked entry');
select is((select (r->'contest'->'top'->0->>'likes')::int from wr), 2, 'with its likes');
select is((select r->'remix'->>'set_id' from wr), 'd9000000-0000-4000-8000-000000000003', 'remix of the week: the most-liked PUBLIC remix of the last seven days - not the private one with more likes, not the old one');
select is((select r->'remix'->>'remixed_from_label' from wr), 'Remixed from @wrb', 'with its credit');
select is((select (r->'me'->>'new_followers')::int from wr), 0, 'c: no new followers');
select pg_temp.act_as('d9d9d9d9-0000-4000-8000-000000000002');
select is((select (weekly_recap()->'me'->>'likes_received')::int), 2, 'b: two likes received this week (their entry)');
select is((select (weekly_recap()->'me'->>'new_followers')::int), 1, 'b: one new follower');
-- The recap stops showing once the weekend is over; the challenge itself stays in the answer for a week.
select pg_temp.back();
update contests set closes_at = now() - interval '4 days' where id = 'd9000000-0000-4000-8000-000000000011';
select pg_temp.act_as('d9d9d9d9-0000-4000-8000-000000000003');
select is((select (weekly_recap()->>'show')::boolean), false, 'four days after the close: the card is gone');

select * from finish();
rollback;
