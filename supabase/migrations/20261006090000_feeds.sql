-- 036 · Feeds (roadmap M6.2; spec 9 #6–#7; decision 84): the following feed and the featured
-- feed. Both run as the CALLER (security invoker), so `can_view_set` still decides every row - a
-- draft, an only-me set, a followers-only set you do not follow, or anything across a block never
-- reaches a feed. On top of that, both leave out people you have muted (spec 10.4 #5).
--
-- "Featured" is Top sets: public published sets ranked by what people did with them this week
-- (likes, reactions, comments), with an optional editor's pick stamped by the server or an admin
-- in `featured_at`. Nobody picks their own set: a person's update may not touch that column.
-- Spec 4.7 #1.3 is honoured - whole published sets are featured, never a library of clipped
-- pictures.

alter table public.sets add column featured_at timestamptz;
create index sets_featured_idx on public.sets (featured_at desc)
  where featured_at is not null and status = 'published' and visibility = 'public' and deleted_at is null;

-- The guard from 010 with one more server-only column.
create or replace function private.sets_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin())
     or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.takedown_state is distinct from old.takedown_state
     or new.share_code is distinct from old.share_code
     or new.featured_at is distinct from old.featured_at then
    raise exception 'owner_id, takedown_state, share_code and featured_at are set by the server only';
  end if;
  if new.status = 'published' and old.status = 'draft' then
    new.published_at := coalesce(old.published_at, now());
  end if;
  return new;
end;
$$;

-- Following: newest first from the people you follow, paged by published_at.
create or replace function public.feed_following(p_before timestamptz default null, p_limit integer default 20)
returns setof public.sets language sql stable security invoker set search_path = '' as $$
  select s.* from public.sets s
   where s.status = 'published' and s.deleted_at is null
     and s.owner_id in (select f.followee_id from public.follows f where f.follower_id = (select auth.uid()))
     and not private.is_muted((select auth.uid()), s.owner_id)
     and (p_before is null or s.published_at < p_before)
   order by s.published_at desc nulls last
   limit least(greatest(p_limit, 1), 50);
$$;
revoke all on function public.feed_following(timestamptz, integer) from public;
grant execute on function public.feed_following(timestamptz, integer) to authenticated;

-- Featured: editor's picks first, then this week's most-loved public sets, paged by offset
-- (the ranking moves, so a time cursor would skip rows). Your own sets are not featured to you.
create or replace function public.feed_featured(p_offset integer default 0, p_limit integer default 20)
returns setof public.sets language sql stable security invoker set search_path = '' as $$
  select s.* from public.sets s
   where s.status = 'published' and s.deleted_at is null and s.visibility = 'public'
     and s.owner_id <> (select auth.uid())
     and not private.is_muted((select auth.uid()), s.owner_id)
   order by s.featured_at desc nulls last,
            ( (select count(*) from public.likes l where l.set_id = s.id and l.created_at > now() - interval '7 days')
            + (select count(*) from public.reactions r where r.set_id = s.id and r.created_at > now() - interval '7 days')
            + 2 * (select count(*) from public.comments c where c.set_id = s.id and c.deleted_at is null and c.created_at > now() - interval '7 days')
            ) desc,
            s.published_at desc nulls last
   limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0);
$$;
revoke all on function public.feed_featured(integer, integer) from public;
grant execute on function public.feed_featured(integer, integer) to authenticated;
