-- 081 · Mentions (spec 7.4 #4; 12.1 #1): "@name" in a comment tells that person, if they allow
-- it. Who may mention you is your own setting, default "people you follow" (the spec's
-- default, chosen against harassment): a stranger's @ is just text. Blocked either way is never
-- told; nobody is told of their own comment; the set's owner already hears of the comment and
-- is not told twice; at most five names per comment count.

alter table public.profiles add column mention_setting text not null default 'following'
  constraint profiles_mention_setting check (mention_setting in ('everyone', 'following', 'nobody'));
comment on column public.profiles.mention_setting is 'Who may mention me in a comment: everyone, people I follow (default), nobody (spec 7.4 #4).';

alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided', 'remix', 'mention'));

-- The names in a text: "@name", letters, digits and underscores, 3 to 30 long, at most five.
create or replace function private.mentioned_names(p_text text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}'::text[])
  from (select m from regexp_matches(coalesce(p_text, ''), '(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})', 'g') as m limit 5) x;
$$;

create or replace function private.notify_mentions() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_name text; v_user uuid; v_setting text;
begin
  -- A comment the word list is holding is seen by its author and the moderators only: no @ tells.
  if new.held_at is not null then return new; end if;
  select s.owner_id into v_owner from public.sets s where s.id = new.set_id;
  foreach v_name in array private.mentioned_names(new.body) loop
    select p.user_id, p.mention_setting into v_user, v_setting
      from public.profiles p where lower(p.username) = v_name and p.deactivated_at is null;
    if v_user is null or v_user = new.author_id or v_user = v_owner then continue; end if;
    if v_setting = 'nobody' then continue; end if;
    if v_setting = 'following' and not (select private.is_following(v_user, new.author_id)) then continue; end if;
    -- notify() itself drops a pair that is blocked either way.
    perform private.notify(v_user, 'mention', new.author_id, 'set', new.set_id, false);
  end loop;
  return new;
end $$;
create trigger comments_mentions after insert on public.comments for each row execute function private.notify_mentions();
