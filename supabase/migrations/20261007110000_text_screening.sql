-- 062 · Text screening, the word-list half (roadmap M7.1; spec 13.2 #1–#4). What the database
-- can do without an outside service: a phone number or a street address in a caption, a bio or
-- a comment is REFUSED (P0006 - the screen says so before anything is saved); a comment that
-- reaches for eating-disorder or self-harm language is HELD - saved, visible to its author only,
-- and a report lands in the moderators' queue; a caption that does the same is published and
-- reported. The phrase list is the one the Search tab's help card uses (`src/safety/risky.ts`),
-- so the two stay one list. The OpenAI moderation call (spec 13.2 #1) needs an account that is
-- the owner's to make (OW18); when it exists it becomes a second opinion on the same verdict.

create or replace function private.held_phrases()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'thinspo',
    'thinspiration',
    'pro ana',
    'proana',
    'pro mia',
    'promia',
    'meanspo',
    'bonespo',
    'thigh gap',
    'ana tips',
    'ana diet',
    'mia tips',
    'ed tips',
    'fasting tips',
    'how to not eat',
    'stop eating',
    'lose weight fast',
    'collarbones',
    'hip bones showing',
    'ribs showing',
    'ana buddy',
    'fat burning',
    'starve',
    'starving',
    'purge',
    'purging',
    'laxative',
    'diet pills',
    'calorie',
    'calories',
    'body check',
    'self harm',
    'self-harm',
    'cutting scars',
    'kill myself',
    'suicide'
  ];
$$;
revoke all on function private.held_phrases() from public;

-- The verdict: 'refuse' | 'hold' | 'ok'. Callable by the app too, so a screen can warn before
-- it saves; the triggers below ask the same function, so the warning and the rule never differ.
create or replace function public.text_verdict(p_text text, p_kind text default 'comment')
returns text language plpgsql immutable security definer set search_path = '' as $$
declare t text := lower(coalesce(p_text, '')); ph text;
begin
  if t = '' then return 'ok'; end if;
  -- A phone number (US shapes) or a street address: never in public words (spec 13.2 #4).
  if p_kind in ('caption', 'bio', 'comment') then
    if t ~ '(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}' then return 'refuse'; end if;
    if t ~ '\m\d{1,6}\s+[a-z0-9.''-]+(\s+[a-z0-9.''-]+){0,3}\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|ter|parkway|pkwy|highway|hwy)\M\.?' then return 'refuse'; end if;
  end if;
  foreach ph in array private.held_phrases() loop
    if t ~ ('\m' || regexp_replace(ph, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '\M') then return 'hold'; end if;
  end loop;
  return 'ok';
end $$;
revoke all on function public.text_verdict(text, text) from public, anon;
grant execute on function public.text_verdict(text, text) to authenticated;

-- A held comment: saved, seen by its author (and moderators) only, reported to the queue.
alter table public.comments add column held_at timestamptz;
create index comments_held_idx on public.comments (held_at) where held_at is not null;

create or replace function private.comments_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text; owner uuid; ref text;
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  v := public.text_verdict(new.body, 'comment');
  if v = 'refuse' then raise exception 'no phone numbers or addresses' using errcode = 'P0006'; end if;
  if v = 'hold' then
    new.held_at := now();
    select s.owner_id into owner from public.sets s where s.id = new.set_id;
    ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
    insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
    values (ref, new.author_id, 'comment', new.id, new.author_id, 'self_harm', 'held by the word list', 'urgent');
  end if;
  return new;
end $$;
create trigger comments_screen before insert on public.comments
  for each row execute function private.comments_screen();

-- An edit is screened the same way (the guard from 030 keeps the other rules).
create or replace function private.comments_screen_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if new.body <> old.body and public.text_verdict(new.body, 'comment') = 'refuse' then
    raise exception 'no phone numbers or addresses' using errcode = 'P0006';
  end if;
  return new;
end $$;
create trigger comments_screen_edit before update on public.comments
  for each row execute function private.comments_screen_edit();

drop policy "comments: viewers read" on public.comments;
create policy "comments: viewers read" on public.comments for select to authenticated
  using (
    (select public.can_view_set(set_id, (select auth.uid())))
    and not (select private.blocked_either_way((select auth.uid()), author_id))
    and (
      (select private.set_owner(set_id)) = (select auth.uid())
      or exists (select 1 from public.sets s where s.id = set_id and s.comments_setting <> 'off')
    )
    and (held_at is null or author_id = (select auth.uid()) or (select private.is_moderator()))
  );

-- A caption: refused with a phone number or address; reported (not hidden) for held phrases.
create or replace function private.sets_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cap text := coalesce(new.layout ->> 'caption', ''); v text; ref text;
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if tg_op = 'UPDATE' and cap = coalesce(old.layout ->> 'caption', '') then return new; end if;
  v := public.text_verdict(cap, 'caption');
  if v = 'refuse' then raise exception 'no phone numbers or addresses' using errcode = 'P0006'; end if;
  if v = 'hold' and tg_op = 'UPDATE' and not exists (
       select 1 from public.reports r where r.target_type = 'set' and r.target_id = new.id and r.state in ('open', 'reviewing')) then
    ref := 'K-' || upper(substr(private.new_share_code(), 1, 8));
    insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
    values (ref, new.owner_id, 'set', new.id, new.owner_id, 'self_harm', 'caption held by the word list', 'urgent');
  end if;
  return new;
end $$;
create trigger sets_screen before insert or update on public.sets
  for each row execute function private.sets_screen();

-- A bio: refused with a phone number or address (spec 13.2 #4; the profile holds no phone field).
create or replace function private.profiles_bio_screen()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('kleit.server_write', true) = '1' then return new; end if;
  if (tg_op = 'INSERT' or new.bio is distinct from old.bio) and public.text_verdict(new.bio, 'bio') = 'refuse' then
    raise exception 'no phone numbers or addresses' using errcode = 'P0006';
  end if;
  return new;
end $$;
create trigger profiles_bio_screen before insert or update on public.profiles
  for each row execute function private.profiles_bio_screen();

-- A moderator dismissing a held comment's report lets the comment show (the latest `moderate`,
-- 045, plus one branch - L31).
create or replace function public.moderate(p_report uuid, p_action text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.reports%rowtype; me uuid := auth.uid(); was text;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  select * into r from public.reports where id = p_report;
  if r.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_action not in ('dismiss', 'remove', 'strike', 'ban') then raise exception 'unknown action' using errcode = '22023'; end if;
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  if p_action in ('remove', 'strike', 'ban') then
    if r.target_type = 'set' then
      update public.sets set takedown_state = 'removed' where id = r.target_id;
    elsif r.target_type = 'item' then
      update public.items set takedown_state = 'removed' where id = r.target_id;
    elsif r.target_type = 'comment' then
      update public.comments set deleted_at = coalesce(deleted_at, now()) where id = r.target_id;
    elsif r.target_type = 'group' then
      update public.groups set deleted_at = coalesce(deleted_at, now()) where id = r.target_id;
    end if;
  end if;
  if p_action = 'dismiss' and r.target_type = 'comment' then
    update public.comments set held_at = null where id = r.target_id and held_at is not null;
  end if;
  if p_action = 'strike' and r.target_owner_id is not null then
    insert into public.strikes (user_id, reason, report_id) values (r.target_owner_id, coalesce(p_note, ''), r.id);
  end if;
  if p_action = 'ban' and r.target_owner_id is not null then
    update public.profiles set banned_at = coalesce(banned_at, now()) where user_id = r.target_owner_id;
  end if;
  update public.reports set state = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
                            resolution_note = coalesce(p_note, '')
   where id = r.id;
  perform set_config('kleit.server_write', was, true);
  insert into public.moderation_actions (moderator_id, report_id, target_type, target_id, target_user_id, action, note)
  values (me, r.id, r.target_type, r.target_id, r.target_owner_id, p_action, coalesce(p_note, ''));
end $$;
revoke all on function public.moderate(uuid, text, text) from public;
grant execute on function public.moderate(uuid, text, text) to authenticated;
