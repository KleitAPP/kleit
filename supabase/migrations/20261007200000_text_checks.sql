-- 071 · Text screening, the second opinion (spec 13.2 #1; OW18 answered 2026-10-07). The word
-- list (062) answers at once, inside the write. This adds the outside check that no trigger can
-- wait for: every new comment, changed caption and changed bio is queued in `text_checks`; a
-- pg_cron timer posts to the `screen-text` function every five minutes with the sweep secret;
-- the function asks OpenAI's moderation endpoint and records the answer through one door,
-- `record_text_check`, which holds a flagged comment (author only) and files a report for a
-- flagged comment, caption or bio - the same shapes the word list uses, so the queue looks the
-- same to a moderator. With no key in the function's environment nothing is claimed and
-- nothing is lost: the rows wait.

create table public.text_checks (
  id bigint generated always as identity primary key,
  kind text not null constraint text_checks_kind check (kind in ('comment', 'caption', 'bio')),
  target_id uuid not null,
  author_id uuid references auth.users (id) on delete cascade,
  body text not null,
  state text not null default 'pending' constraint text_checks_state check (state in ('pending', 'ok', 'flagged', 'failed')),
  attempts integer not null default 0,
  labels jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  checked_at timestamptz
);
alter table public.text_checks enable row level security;
revoke all on table public.text_checks from anon, authenticated;
create index text_checks_pending_idx on public.text_checks (created_at) where state = 'pending';

-- Queueing, by trigger. A comment's text, a caption, a bio - only when it changed and is not empty.
create or replace function private.queue_text_check(p_kind text, p_target uuid, p_author uuid, p_body text)
returns void language sql security definer set search_path = '' as $$
  insert into public.text_checks (kind, target_id, author_id, body)
  select p_kind, p_target, p_author, left(p_body, 4000) where btrim(coalesce(p_body, '')) <> '';
$$;
revoke all on function private.queue_text_check(text, uuid, uuid, text) from public, anon, authenticated;

create or replace function private.comments_queue_check() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.body <> old.body then perform private.queue_text_check('comment', new.id, new.author_id, new.body); end if;
  return new;
end $$;
create trigger comments_queue_check after insert or update on public.comments for each row execute function private.comments_queue_check();

create or replace function private.sets_queue_check() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap text := coalesce(new.layout ->> 'caption', '');
begin
  if cap <> '' and (tg_op = 'INSERT' or cap <> coalesce(old.layout ->> 'caption', '')) then
    perform private.queue_text_check('caption', new.id, new.owner_id, cap);
  end if;
  return new;
end $$;
create trigger sets_queue_check after insert or update on public.sets for each row execute function private.sets_queue_check();

create or replace function private.profiles_queue_check() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.bio, '') <> '' and (tg_op = 'INSERT' or new.bio is distinct from old.bio) then
    perform private.queue_text_check('bio', new.user_id, new.user_id, new.bio);
  end if;
  return new;
end $$;
create trigger profiles_queue_check after insert or update on public.profiles for each row execute function private.profiles_queue_check();

-- The function's two doors (service role only).
create or replace function public.claim_text_checks(p_limit integer default 20)
returns table (id bigint, kind text, target_id uuid, body text)
language sql security definer set search_path = '' as $$
  with picked as (
    select c.id from public.text_checks c
     where c.state = 'pending' and c.attempts < 5
       and (c.attempts = 0 or c.updated_at < now() - interval '10 minutes')
     order by c.created_at
     limit least(greatest(coalesce(p_limit, 1), 1), 100)
     for update of c skip locked
  )
  update public.text_checks t set attempts = t.attempts + 1, updated_at = now()
    from picked where t.id = picked.id
  returning t.id, t.kind, t.target_id, t.body;
$$;
revoke all on function public.claim_text_checks(integer) from public, anon, authenticated;
grant execute on function public.claim_text_checks(integer) to service_role;

create or replace function public.record_text_check(p_id bigint, p_state text, p_labels jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.text_checks%rowtype; was text; reports_today integer;
begin
  if p_state not in ('ok', 'flagged', 'failed') then raise exception 'unknown state' using errcode = '22023'; end if;
  select * into c from public.text_checks where id = p_id;
  if c.id is null then return; end if;
  update public.text_checks set state = p_state, labels = p_labels, checked_at = case when p_state = 'failed' then null else now() end,
         updated_at = now()
   where id = p_id;
  if p_state = 'failed' then
    -- Five tries, then it is left for a person to notice in the log; the text stays as it is.
    if c.attempts >= 5 then update public.text_checks set state = 'failed' where id = p_id; else update public.text_checks set state = 'pending' where id = p_id; end if;
    return;
  end if;
  if p_state <> 'flagged' then return; end if;
  select count(*) into reports_today from public.reports r
   where r.reporter_id = c.author_id and r.note like '%by the moderation check' and r.created_at > now() - interval '1 day';
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  if c.kind = 'comment' then
    update public.comments set held_at = coalesce(held_at, now()) where id = c.target_id and deleted_at is null;
  end if;
  perform set_config('kleit.server_write', was, true);
  if reports_today < 5 and c.author_id is not null and not exists (
       select 1 from public.reports r where r.target_type = case c.kind when 'comment' then 'comment' when 'caption' then 'set' else 'profile' end
                                         and r.target_id = c.target_id and r.state in ('open', 'reviewing')) then
    insert into public.reports (request_ref, reporter_id, target_type, target_id, target_owner_id, reason, note, priority)
    values ('K-' || upper(substr(private.new_share_code(), 1, 8)), c.author_id,
            case c.kind when 'comment' then 'comment' when 'caption' then 'set' else 'profile' end, c.target_id, c.author_id,
            case when p_labels ? 'self-harm' or p_labels ? 'self-harm/intent' or p_labels ? 'self-harm/instructions' then 'self_harm'
                 when p_labels ? 'sexual/minors' then 'underage'
                 when p_labels ? 'harassment' or p_labels ? 'harassment/threatening' then 'harassment'
                 when p_labels ? 'hate' or p_labels ? 'hate/threatening' then 'hate'
                 when p_labels ? 'sexual' then 'nudity'
                 else 'other' end,
            c.kind || ' flagged by the moderation check', 'urgent');
  end if;
end $$;
revoke all on function public.record_text_check(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_text_check(bigint, text, jsonb) to service_role;

-- The timer: every five minutes, like the sweeper, with the same secret and address pattern.
create or replace function private.screen_texts()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.text_checks where state = 'pending' and attempts < 5) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sweep_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sweep_secret' limit 1;
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := replace(v_url, '/sweep-images', '/screen-text'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sweep-key', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function private.screen_texts() from public, anon, authenticated;
select cron.unschedule('screen-text') where exists (select 1 from cron.job where jobname = 'screen-text');
select cron.schedule('screen-text', '*/5 * * * *', $$select private.screen_texts()$$);

-- The nightly cleanup forgets checked rows after 30 days (the text is a copy; the report keeps what matters).
create or replace function private.cleanup_text_checks() returns integer language sql security definer set search_path = '' as $$
  with gone as (delete from public.text_checks where checked_at < now() - interval '30 days' returning 1) select count(*)::int from gone;
$$;
revoke all on function private.cleanup_text_checks() from public, anon, authenticated;
select cron.unschedule('cleanup-text-checks') where exists (select 1 from cron.job where jobname = 'cleanup-text-checks');
select cron.schedule('cleanup-text-checks', '20 9 * * *', $$select private.cleanup_text_checks()$$);
