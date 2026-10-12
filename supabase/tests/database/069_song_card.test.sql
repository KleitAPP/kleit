-- Tests for migration 091: a set's song is a link to one of the three services with a cover from
-- their own picture hosts, short screened words, whole or absent; the share page carries it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into auth.users (id, email) values ('f2f2f2f2-0000-4000-8000-000000000001', 'sc-owner@test.kleit');
insert into profiles (user_id, username, age_confirmed_at, terms_version) values
  ('f2f2f2f2-0000-4000-8000-000000000001', 'scowner', now(), 't');
insert into sets (id, owner_id, title, status, visibility, share_code, published_at) values
  ('f2000000-0000-4000-8000-000000000001', 'f2f2f2f2-0000-4000-8000-000000000001', 'sc set', 'published', 'public', 'scsongcard000001', now());

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

select pg_temp.act_as('f2f2f2f2-0000-4000-8000-000000000001');
-- 1. The shape.
select throws_ok($$ update sets set song_url = 'https://evil.example/song', song_title = 'x' where id = 'f2000000-0000-4000-8000-000000000001' $$, '23514', null, 'owner: a song link is one of the three services, nothing else');
select throws_ok($$ update sets set song_url = 'https://open.spotify.com/track/abc', song_title = 'x', song_cover_url = 'https://evil.example/pixel.gif' where id = 'f2000000-0000-4000-8000-000000000001' $$, '23514', null, 'owner: a cover comes from the services'' picture hosts only');
select throws_ok($$ update sets set song_title = 'orphan words' where id = 'f2000000-0000-4000-8000-000000000001' $$, '23514', null, 'owner: words without a link are not a song');
select throws_ok($$ update sets set song_url = 'https://open.spotify.com/track/abc', song_title = 'call me 212-555-0199' where id = 'f2000000-0000-4000-8000-000000000001' $$, 'P0006', null, 'owner: the words are screened like a caption');
-- 2. A real one.
select lives_ok($$ update sets set song_url = 'https://open.spotify.com/track/abc', song_title = 'Sc Song', song_artist = 'Sc Artist', song_cover_url = 'https://i.scdn.co/image/abc' where id = 'f2000000-0000-4000-8000-000000000001' $$, 'owner: a Spotify song with its cover is saved');
select pg_temp.back();
select is((select count(*)::int from text_checks where kind = 'caption' and target_id = 'f2000000-0000-4000-8000-000000000001' and body = 'Sc Song Sc Artist'), 1, 'the words are queued for the outside check');
select is((select shared_set('scsongcard000001') -> 'song' ->> 'title'), 'Sc Song', 'the share page carries the song');
select is((select shared_set('scsongcard000001') -> 'song' ->> 'url'), 'https://open.spotify.com/track/abc', 'with its link');
-- 3. Taking it off.
select pg_temp.act_as('f2f2f2f2-0000-4000-8000-000000000001');
select lives_ok($$ update sets set song_url = null, song_title = null, song_artist = null, song_cover_url = null where id = 'f2000000-0000-4000-8000-000000000001' $$, 'owner: the song comes off whole');

select * from finish();
rollback;
