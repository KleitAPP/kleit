-- 089 · The weekly rhythm, finished (spec 11 #4: "Monday contest theme, Friday results, weekly
-- recap, price-drop alerts on saved items, 'Remix of the week'"; design pack S94). Two things:
--
-- 1. The Monday theme now closes on Friday. 043 gave it seven days, which put the results on the
--    next Monday; the spec says Friday, and the daily announcer at 13:05 UTC already assumed it.
--    A challenge started by hand keeps whatever length the admin chose.
-- 2. `weekly_recap()`: one call for the recap card and screen - the challenge that just closed
--    (its picks, then its top three by likes), the remix of the week (the most-liked public
--    remix published in the last seven days), and the person's own week (sets published, likes
--    received, new followers, pieces saved). Security invoker: every row is read as the caller,
--    so a private remix or a set across a block is simply not there. `show` is true from a
--    Friday close until Monday morning - the weekend the recap is for.
--
-- Replaced from its latest definition (L31): open_weekly_contest (043, the only one).

create or replace function private.open_weekly_contest()
returns uuid language plpgsql security definer set search_path = '' as $$
declare th public.contest_themes%rowtype; cid uuid;
begin
  if exists (select 1 from public.contests c where now() >= c.opens_at and now() < c.closes_at) then
    return null;
  end if;
  select * into th from public.contest_themes t where t.used_at is null order by t.position limit 1;
  if th.id is null then return null; end if;
  -- Monday 13:00 UTC → Friday 13:00 UTC: results on Friday (spec 11 #4).
  insert into public.contests (title, theme, opens_at, closes_at)
  values (th.title, th.theme, now(), now() + interval '4 days') returning id into cid;
  update public.contest_themes set used_at = now() where id = th.id;
  return cid;
end $$;
revoke all on function private.open_weekly_contest() from public;

create or replace function public.weekly_recap()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with me as (select auth.uid() as id),
  since as (select now() - interval '7 days' as t),
  last_contest as (
    select c.* from public.contests c
     where c.closes_at <= now() and c.closes_at > now() - interval '7 days'
     order by c.closes_at desc limit 1
  ),
  board as (
    select e.set_id, e.user_id, e.picked_at, s.title, s.preview_image_id, p.username,
           (select count(*) from public.likes l where l.set_id = e.set_id and l.created_at >= c.opens_at) as likes
      from last_contest c
      join public.contest_entries e on e.contest_id = c.id
      join public.sets s on s.id = e.set_id
      join public.profiles p on p.user_id = e.user_id
  ),
  remix as (
    select s.id as set_id, s.title, s.preview_image_id, s.remixed_from_label, p.username,
           (select count(*) from public.likes l where l.set_id = s.id and l.created_at >= (select t from since)) as likes
      from public.sets s
      join public.profiles p on p.user_id = s.owner_id
     where s.remixed_from_set_id is not null and s.status = 'published' and s.visibility = 'public'
       and s.deleted_at is null and s.takedown_state = 'none' and s.preview_image_id is not null
       and s.published_at >= (select t from since)
     order by likes desc, s.published_at desc
     limit 1
  )
  select jsonb_build_object(
    'show', exists (select 1 from last_contest c where c.closes_at > now() - interval '3 days'),
    'contest', (select jsonb_build_object(
        'id', c.id, 'title', c.title, 'closes_at', c.closes_at,
        'entries', (select count(*) from board),
        'picks', coalesce((select jsonb_agg(jsonb_build_object('set_id', b.set_id, 'title', b.title, 'username', b.username, 'preview_image_id', b.preview_image_id) order by b.picked_at)
                           from board b where b.picked_at is not null), '[]'::jsonb),
        'top', coalesce((select jsonb_agg(t.x order by t.likes desc) from (
                  select jsonb_build_object('set_id', b.set_id, 'title', b.title, 'username', b.username, 'preview_image_id', b.preview_image_id, 'likes', b.likes) as x, b.likes
                    from board b order by b.likes desc, b.picked_at nulls last limit 3) t), '[]'::jsonb)
      ) from last_contest c),
    'remix', (select jsonb_build_object('set_id', r.set_id, 'title', r.title, 'username', r.username, 'preview_image_id', r.preview_image_id,
                                        'likes', r.likes, 'remixed_from_label', r.remixed_from_label) from remix r),
    'me', jsonb_build_object(
      'sets_published', (select count(*) from public.sets s where s.owner_id = (select id from me) and s.status = 'published' and s.deleted_at is null and s.published_at >= (select t from since)),
      'likes_received', (select count(*) from public.likes l join public.sets s on s.id = l.set_id where s.owner_id = (select id from me) and l.user_id <> (select id from me) and l.created_at >= (select t from since)),
      'new_followers', (select count(*) from public.follows f where f.followee_id = (select id from me) and f.created_at >= (select t from since)),
      'pieces_saved', (select count(*) from public.saved_items i where i.user_id = (select id from me) and i.created_at >= (select t from since))
    )
  );
$$;
revoke all on function public.weekly_recap() from public, anon;
grant execute on function public.weekly_recap() to authenticated;
