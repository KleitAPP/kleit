-- 110 · Three halves the register still held after the 10-18/19 sitting (owner-free):
--   1. the notification grid's in-app column (spec 12.1 #6; CL68): each kind can be turned off
--      in the Inbox as well as on the phone, and "marketing" is a remembered no (off by default);
--   2. the recovery form's topic (spec 3.6 #2; CL66): "I can't sign in" on the contact form,
--      so a person with no way in reaches a human through the one door that has no account;
--   3. suggested people (spec 3.5 #10; CL67): stylists, challenge winners and style matches -
--      never from contacts or location - for anyone who has not said "don't suggest my account".

-- ---------------------------------------------------------------------------
-- 1. The in-app column. `push_settings` is the one row of notification settings a person has
--    (073: push on/off, the zone; 078: the kinds muted on the phone). Two more columns: the
--    kinds muted in the app, and the marketing answer (no until they say so, spec 12.1 #6).
--    A muted kind is still written - a push for it may still go, the grid's columns are
--    independent - and the Inbox and the badge leave it out.
-- ---------------------------------------------------------------------------
alter table public.push_settings add column muted_in_app text[] not null default '{}';
alter table public.push_settings add column marketing_email boolean not null default false;
comment on column public.push_settings.muted_in_app is 'Notification kinds the person does not want in the Inbox; everything else shows (spec 12.1 #6).';
comment on column public.push_settings.marketing_email is 'Marketing email, off until the person says yes (spec 12.1 #6). Nothing sends any yet (CL43).';

-- The badge count (031's text plus the one filter; the only definition - L31).
create or replace function public.unread_notifications()
returns bigint language sql stable set search_path = '' as $$
  select count(*) from public.notifications n
   where n.user_id = auth.uid() and n.read_at is null
     and not (n.kind = any (coalesce((select s.muted_in_app from public.push_settings s where s.user_id = auth.uid()), '{}')));
$$;
revoke all on function public.unread_notifications() from public;
grant execute on function public.unread_notifications() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The contact form's sixth topic (053's constraint, by name).
-- ---------------------------------------------------------------------------
alter table public.contact_messages drop constraint contact_topic;
alter table public.contact_messages add constraint contact_topic
  check (topic in ('question', 'bug', 'account', 'safety', 'other', 'recovery'));

-- ---------------------------------------------------------------------------
-- 3. Suggested people. Three reasons, in this order: an account Kleit labelled (stylist, brand,
--    staff - 090), somebody whose set an admin picked in a challenge (085), and a style match -
--    a person whose public sets carry the tags or the stores yours do. Never somebody you follow
--    or asked to follow, muted, or blocked either way; never a hidden account; never anyone who
--    turned "suggest my account" off (`profiles.suggestable`, 001). Runs as the server because
--    it reads other people's challenge picks and sets, and hands back only what a profile
--    already shows. Twelve by default, thirty at most.
-- ---------------------------------------------------------------------------
create or replace function public.suggested_people(p_limit integer default 12)
returns table (user_id uuid, username text, display_name text, is_private boolean, label public.account_label, avatar_item_id uuid, why text)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as id),
  my_tags as (
    select distinct unnest(s.tags) as tag from public.sets s
     where s.owner_id = (select id from me) and s.deleted_at is null
  ),
  my_stores as (
    select distinct i.source_domain as domain
      from public.sets s join public.set_items si on si.set_id = s.id join public.items i on i.id = si.item_id
     where s.owner_id = (select id from me) and s.deleted_at is null and i.source_domain is not null
  ),
  theirs as (
    select s.owner_id, unnest(s.tags) as tag, null::text as domain
      from public.sets s
     where s.status = 'published' and s.visibility = 'public' and s.deleted_at is null and s.takedown_state = 'none'
    union all
    select s.owner_id, null::text, i.source_domain
      from public.sets s join public.set_items si on si.set_id = s.id join public.items i on i.id = si.item_id
     where s.status = 'published' and s.visibility = 'public' and s.deleted_at is null and s.takedown_state = 'none'
       and i.source_domain is not null
  ),
  matches as (
    select t.owner_id, count(distinct t.tag) filter (where t.tag in (select tag from my_tags))
                     + count(distinct t.domain) filter (where t.domain in (select domain from my_stores)) as score
      from theirs t group by t.owner_id
  ),
  candidates as (
    select p.user_id, p.username, p.display_name, p.is_private, p.label, p.avatar_item_id,
           case when p.label <> 'none' then 'label'
                when exists (select 1 from public.contest_entries ce where ce.user_id = p.user_id and ce.picked_at is not null) then 'winner'
                else 'match' end as why,
           coalesce(m.score, 0) as score,
           p.created_at
      from public.profiles p left join matches m on m.owner_id = p.user_id
     where (select id from me) is not null
       and p.user_id <> (select id from me)
       and p.suggestable
       and not (select private.is_hidden_account(p.user_id))
       and not (select private.blocked_either_way((select id from me), p.user_id))
       and not exists (select 1 from public.follows f where f.follower_id = (select id from me) and f.followee_id = p.user_id)
       and not exists (select 1 from public.follow_requests r where r.requester_id = (select id from me) and r.target_id = p.user_id)
       and not exists (select 1 from public.mutes mu where mu.muter_id = (select id from me) and mu.muted_id = p.user_id)
  )
  select c.user_id, c.username, c.display_name, c.is_private, c.label, c.avatar_item_id, c.why
    from candidates c
   where c.why in ('label', 'winner') or c.score > 0
   order by (c.why = 'label') desc, (c.why = 'winner') desc, c.score desc, c.created_at desc
   limit least(greatest(coalesce(p_limit, 12), 1), 30);
$$;
revoke all on function public.suggested_people(integer) from public, anon;
grant execute on function public.suggested_people(integer) to authenticated;
