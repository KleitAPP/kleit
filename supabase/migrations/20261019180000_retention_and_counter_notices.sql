-- 115 · Retention as the data map says, and the DMCA counter-notice (spec 14.2, 14.3 #1,
-- 13.3 #4; the copyright policy draft's sections 3 and 4), 2026-10-19. Each function replaced
-- here starts from its latest text (L31): nightly_cleanup() from 051, finalize_account_deletions()
-- from 076, claim_purges() from 065, strikes_ban_at_three() from 065, takedown_resolve() from 059.
--
-- 1. The data map's periods, kept by the night job: the 18+ record a year after deletion (it was
--    stamped 30 days, against the table's own comment); resolved reports, moderation actions,
--    strikes, takedowns, counter-notices, contact messages and the audit log at two years.
-- 2. The stored files the night job could not reach: export ZIPs after seven days, the evidence
--    copy of a taken-down picture after a year, and the private fonts and exports of an account
--    that is gone. claim_file_purges() lists them from storage's own table; purge-files removes
--    them through the API, which is the only thing that removes the bytes.
-- 3. A valid copyright takedown is one copyright strike on the uploader (90 days; three live ones
--    close the account), and the uploader can send a counter-notice from a public page with no
--    account; a moderator restores the picture 14 days on unless the claimant says they have sued.
--    The picture of a copyright takedown is held from the purge for 21 days so a restore has
--    something to restore.

-- ---------------------------------------------------------------------------
-- 1. The 18+ record: a year, as the table says (spec 3.7 #13, data map).
-- ---------------------------------------------------------------------------
create or replace function private.finalize_account_deletions()
returns integer language plpgsql security definer set search_path = '' as $$
declare d record; n integer := 0;
begin
  perform set_config('kleit.server_write', '1', true);
  for d in select user_id from public.account_deletions where state = 'pending' and final_at <= now() loop
    -- Remixes of their sets stay, credited to a deleted account (spec 3.7 #8).
    update public.sets set remixed_from_set_id = null, remixed_from_label = 'Remixed from a deleted account'
     where remixed_from_set_id in (select id from public.sets where owner_id = d.user_id);
    -- Their own photos go tonight with no evidence copy (claim_purges: deleted 30 days ago, not taken down);
    -- clipped store pieces stay with no owner (the FK sets null on cascade).
    update public.items set deleted_at = now() - interval '31 days' where owner_id = d.user_id and kind = 'own' and takedown_state = 'none';
    -- Their messages read "unavailable" (the FK sets the sender null; mark them too).
    update public.messages set deleted_at = coalesce(deleted_at, now()) where sender_id = d.user_id;
    -- The 18+ record is kept a year after deletion (spec 3.7 #13; data map 14.2), then purged by the night job.
    update public.age_confirmations set purge_after = now() + interval '1 year' where user_id_hash = encode(sha256(d.user_id::text::bytea), 'hex') and purge_after is null;
    -- The outside services that know the id (spec 3.7 #10): a row per service, drained by send-push.
    insert into public.external_cleanups (user_id, service) values (d.user_id, 'onesignal');
    update public.account_deletions set state = 'completed' where user_id = d.user_id;
    delete from auth.users where id = d.user_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The counter-notice (13.3 #4). Server-written, moderator-read; the sender has no account.
-- ---------------------------------------------------------------------------
create table public.counter_notices (
  id uuid primary key default gen_random_uuid(),
  request_ref text not null unique,
  takedown_id uuid not null references public.takedown_requests (id) on delete cascade,
  name text not null constraint counter_name_length check (char_length(name) between 1 and 120),
  email text not null constraint counter_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text not null constraint counter_address_length check (char_length(address) between 1 and 300),
  phone text not null default '' constraint counter_phone_length check (char_length(phone) <= 40),
  details text not null default '' constraint counter_details_length check (char_length(details) <= 2000),
  -- The good-faith statement under penalty of perjury, and consent to jurisdiction and service.
  statements boolean not null default false,
  consent boolean not null default false,
  signature text not null constraint counter_signature_length check (char_length(signature) between 1 and 120),
  ip_hash text,
  state text not null default 'open' constraint counter_state check (state in ('open', 'restored', 'withheld')),
  -- The policy's "10 to 14 business days": the latest day, when the picture comes back unless the claimant has sued.
  restore_after timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  note text not null default '' constraint counter_note_length check (char_length(note) <= 500)
);
alter table public.counter_notices enable row level security;
revoke all on table public.counter_notices from anon;
revoke insert, update, delete, truncate on table public.counter_notices from authenticated;
create policy "counter_notices: moderators read" on public.counter_notices for select to authenticated using ((select private.is_moderator()));
create index counter_notices_open_idx on public.counter_notices (created_at) where state = 'open';

-- The picture a takedown removed, so a counter-notice knows what to restore.
alter table public.takedown_requests add column item_id uuid references public.items (id) on delete set null;

-- A copyright takedown with a picture strikes its uploader (policy section 4: one strike per
-- notice, 90 days) and remembers the picture; the rest is 059's text.
create or replace function public.takedown_resolve(p_id uuid, p_outcome text, p_note text default '', p_item uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare t public.takedown_requests%rowtype; h text; was text; n integer := 0; uploader uuid;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_outcome not in ('removed', 'rejected') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  select * into t from public.takedown_requests where id = p_id and state = 'open';
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_outcome = 'removed' and p_item is not null then
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    select i.image_hash, i.owner_id into h, uploader from public.items i where i.id = p_item;
    if h is not null then
      insert into public.removed_image_fingerprints (image_hash, reason) values (h, 'takedown:' || t.kind || ':' || t.request_ref) on conflict do nothing;
      update public.items set takedown_state = 'removed' where image_hash = h and takedown_state <> 'removed';
      get diagnostics n = row_count;
    else
      update public.items set takedown_state = 'removed' where id = p_item and takedown_state <> 'removed';
      get diagnostics n = row_count;
    end if;
    perform set_config('kleit.server_write', was, true);
    if t.kind = 'copyright' and uploader is not null
       and not exists (select 1 from public.user_roles x where x.user_id = uploader) then
      insert into public.strikes (user_id, kind, reason, expires_at)
      values (uploader, 'copyright', 'Copyright takedown ' || t.request_ref || ': a picture you added was removed on a valid notice.', now() + interval '90 days');
    end if;
  end if;
  update public.takedown_requests
     set state = p_outcome, resolved_at = now(), resolved_by = auth.uid(), note = coalesce(p_note, ''),
         item_id = case when p_outcome = 'removed' then p_item else null end
   where id = p_id;
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (auth.uid(), 'takedown', p_id, uploader, case when p_outcome = 'removed' then 'remove' else 'dismiss' end,
          coalesce(p_note, '') || case when n > 0 then format(' (%s picture(s) removed)', n) else '' end);
  return n;
end $$;
revoke all on function public.takedown_resolve(uuid, text, text, uuid) from public;
grant execute on function public.takedown_resolve(uuid, text, text, uuid) to authenticated;

-- Three live copyright strikes close the account too (policy section 4 #3), apart from community ones.
create or replace function private.strikes_ban_at_three()
returns trigger language plpgsql security definer set search_path = '' as $$
declare was text;
begin
  if (select count(*) from public.strikes s where s.user_id = new.user_id and s.kind = new.kind and s.expires_at > now()) >= 3 then
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    update public.profiles set banned_at = coalesce(banned_at, now()) where user_id = new.user_id;
    perform set_config('kleit.server_write', was, true);
    perform private.remember_banned_identity(new.user_id, case when new.kind = 'copyright' then 'ban: third copyright strike' else 'ban: third strike' end);
    insert into public.moderation_actions (moderator_id, report_id, target_type, target_id, target_user_id, action, note)
    values (null, new.report_id, 'profile', new.user_id, new.user_id, 'ban', case when new.kind = 'copyright' then 'third copyright strike' else 'third strike' end);
  end if;
  return new;
end $$;

-- The server's door for the public form (the takedown-request function, kind 'counter'): the
-- takedown must be a copyright one that removed a picture. Returns the reference.
create or replace function public.file_counter_notice(p_takedown_ref text, p_name text, p_email text, p_address text, p_phone text,
                                                      p_details text, p_statements boolean, p_consent boolean, p_signature text, p_ip_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.takedown_requests%rowtype; ref text;
begin
  select * into t from public.takedown_requests where request_ref = upper(btrim(p_takedown_ref));
  if t.id is null or t.kind <> 'copyright' or t.state <> 'removed' then raise exception 'not_found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.counter_notices c where c.takedown_id = t.id and c.state = 'open') then raise exception 'already_open' using errcode = 'P0001'; end if;
  if not p_statements or not p_consent then raise exception 'incomplete' using errcode = '22023'; end if;
  ref := 'C-' || upper(substr(private.new_share_code(), 1, 8));
  insert into public.counter_notices (request_ref, takedown_id, name, email, address, phone, details, statements, consent, signature, ip_hash)
  values (ref, t.id, btrim(p_name), lower(btrim(p_email)), btrim(p_address), coalesce(btrim(p_phone), ''), coalesce(btrim(p_details), ''), true, true, btrim(p_signature), p_ip_hash);
  return ref;
end $$;
revoke all on function public.file_counter_notice(text, text, text, text, text, text, boolean, boolean, text, text) from public, anon, authenticated;
grant execute on function public.file_counter_notice(text, text, text, text, text, text, boolean, boolean, text, text) to service_role;

-- The moderator's list: open counter-notices with the takedown they answer.
create or replace function public.counter_notice_queue()
returns table (id uuid, request_ref text, takedown_ref text, takedown_id uuid, item_id uuid, name text, email text, address text, phone text,
               details text, signature text, created_at timestamptz, restore_after timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.request_ref, t.request_ref, t.id, t.item_id, c.name, c.email, c.address, c.phone, c.details, c.signature, c.created_at, c.restore_after
    from public.counter_notices c join public.takedown_requests t on t.id = c.takedown_id
   where (select private.is_moderator()) and c.state = 'open'
   order by c.created_at;
$$;
revoke all on function public.counter_notice_queue() from public;
grant execute on function public.counter_notice_queue() to authenticated;

-- Restored: the picture and its identical copies come back, the fingerprint is forgotten, and the
-- strike ends (policy section 4 #4). Withheld: the claimant has sued; everything stays as it is.
create or replace function public.counter_notice_resolve(p_id uuid, p_outcome text, p_note text default '')
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.counter_notices%rowtype; t public.takedown_requests%rowtype; h text; was text; n integer := 0;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_outcome not in ('restored', 'withheld') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  select * into c from public.counter_notices where id = p_id and state = 'open' for update;
  if c.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into t from public.takedown_requests where id = c.takedown_id;
  if p_outcome = 'restored' and t.item_id is not null then
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    select i.image_hash into h from public.items i where i.id = t.item_id;
    if h is not null then
      delete from public.removed_image_fingerprints where image_hash = h;
      update public.items set takedown_state = 'none' where image_hash = h and takedown_state = 'removed' and purged_at is null;
      get diagnostics n = row_count;
    else
      update public.items set takedown_state = 'none' where id = t.item_id and takedown_state = 'removed' and purged_at is null;
      get diagnostics n = row_count;
    end if;
    perform set_config('kleit.server_write', was, true);
    update public.strikes set expires_at = now()
     where kind = 'copyright' and expires_at > now() and reason like 'Copyright takedown ' || t.request_ref || '%';
  end if;
  update public.counter_notices set state = p_outcome, resolved_at = now(), resolved_by = auth.uid(), note = coalesce(p_note, '') where id = c.id;
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (auth.uid(), 'takedown', t.id, null, case when p_outcome = 'restored' then 'restore' else 'dismiss' end,
          'counter-notice ' || c.request_ref || ': ' || coalesce(p_note, '') || case when n > 0 then format(' (%s picture(s) restored)', n) else '' end);
  return n;
end $$;
revoke all on function public.counter_notice_resolve(uuid, text, text) from public;
grant execute on function public.counter_notice_resolve(uuid, text, text) to authenticated;

-- The sender's own check, like the takedown's: the state and the restore date, nothing else.
create or replace function public.counter_notice_status(p_ref text)
returns table (state text, created_at timestamptz, restore_after timestamptz, resolved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.state, c.created_at, c.restore_after, c.resolved_at from public.counter_notices c where c.request_ref = upper(btrim(p_ref));
$$;
revoke all on function public.counter_notice_status(text) from public;
grant execute on function public.counter_notice_status(text) to anon, authenticated;

-- A copyright takedown's picture waits 21 days before the purge: the counter-notice window.
create or replace function public.claim_purges(p_limit integer default 20)
returns table (id uuid, image_bucket public.image_bucket, image_id text, keep_evidence boolean)
language sql security definer set search_path = '' as $$
  select i.id, i.image_bucket, i.image_id,
         (i.takedown_state = 'removed' and i.owner_id is not null) as keep_evidence
    from public.items i
   where i.image_id is not null
     and i.purged_at is null
     and (i.takedown_state = 'removed'
          or (i.deleted_at is not null and i.deleted_at < now() - interval '30 days'))
     and not exists (
       select 1 from public.items o
        where o.id <> i.id and o.image_bucket = i.image_bucket and o.image_id = i.image_id
          and o.purged_at is null and o.takedown_state = 'none' and o.deleted_at is null)
     and not (i.takedown_state = 'removed' and i.image_hash is not null and exists (
       select 1 from public.removed_image_fingerprints r
        where r.image_hash = i.image_hash and r.reason like 'takedown:copyright:%' and r.added_at > now() - interval '21 days'))
   order by i.takedown_state = 'removed' desc, coalesce(i.deleted_at, i.updated_at)
   limit least(greatest(coalesce(p_limit, 1), 1), 100);
$$;
revoke all on function public.claim_purges(integer) from public, anon, authenticated;
grant execute on function public.claim_purges(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The night job keeps the data map's periods (14.3 #1).
-- ---------------------------------------------------------------------------
create or replace function private.nightly_cleanup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_sets int; n_votes_ip int; n_votes_dev int; n_clicks int; n_notes int; n_msgs int; n_ev int; n_acc int;
        n_age int; n_reports int; n_actions int; n_strikes int; n_takedowns int; n_counters int; n_contact int; n_audit int;
begin
  perform set_config('kleit.server_write', '1', true);
  n_acc := private.finalize_account_deletions();
  delete from public.sets where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n_sets = row_count;
  update public.votes set ip_hash = null where ip_hash is not null and created_at < now() - interval '30 days';
  get diagnostics n_votes_ip = row_count;
  update public.votes set device_hash = 'expired:' || id::text where device_hash not like 'expired:%' and created_at < now() - interval '90 days';
  get diagnostics n_votes_dev = row_count;
  insert into public.click_totals (item_id, day, network, clicks)
    select item_id, created_at::date, network, count(*) from public.clicks where created_at < now() - interval '90 days'
    group by item_id, created_at::date, network
  on conflict (item_id, day, network) do update set clicks = public.click_totals.clicks + excluded.clicks;
  delete from public.clicks where created_at < now() - interval '90 days';
  get diagnostics n_clicks = row_count;
  delete from public.notifications where read_at is not null and read_at < now() - interval '90 days';
  get diagnostics n_notes = row_count;
  update public.messages set body = ' ' where deleted_at is not null and deleted_at < now() - interval '30 days' and body <> ' ';
  get diagnostics n_msgs = row_count;
  update public.reports set evidence = null where evidence is not null and resolved_at is not null and resolved_at < now() - interval '2 years';
  get diagnostics n_ev = row_count;
  -- The data map (14.2): the 18+ record a year after deletion; reports and moderation records two years.
  delete from public.age_confirmations where purge_after is not null and purge_after < now();
  get diagnostics n_age = row_count;
  delete from public.reports where resolved_at is not null and resolved_at < now() - interval '2 years';
  get diagnostics n_reports = row_count;
  delete from public.moderation_actions where created_at < now() - interval '2 years';
  get diagnostics n_actions = row_count;
  delete from public.strikes where created_at < now() - interval '2 years';
  get diagnostics n_strikes = row_count;
  delete from public.counter_notices where resolved_at is not null and resolved_at < now() - interval '2 years';
  get diagnostics n_counters = row_count;
  delete from public.takedown_requests where resolved_at is not null and resolved_at < now() - interval '2 years';
  get diagnostics n_takedowns = row_count;
  delete from public.contact_messages where state <> 'open' and created_at < now() - interval '2 years';
  get diagnostics n_contact = row_count;
  delete from public.admin_audit_log where created_at < now() - interval '2 years';
  get diagnostics n_audit = row_count;
  return jsonb_build_object('accounts', n_acc, 'sets', n_sets, 'votes_ip', n_votes_ip, 'votes_device', n_votes_dev, 'clicks', n_clicks,
                            'notifications', n_notes, 'messages', n_msgs, 'evidence', n_ev, 'age_records', n_age, 'reports', n_reports,
                            'actions', n_actions, 'strikes', n_strikes, 'counter_notices', n_counters, 'takedowns', n_takedowns,
                            'contact', n_contact, 'audit', n_audit);
end $$;

-- The stored files whose time is up (data map): export ZIPs after seven days; the evidence copy
-- of a taken-down picture after a year; the private fonts and exports of an account that is gone.
-- Listed from storage's own table; removed by purge-files through the API, which deletes the bytes.
create or replace function public.claim_file_purges(p_limit integer default 50)
returns table (bucket text, name text)
language sql security definer set search_path = '' as $$
  (select o.bucket_id, o.name from storage.objects o
    where o.bucket_id = 'exports' and o.created_at < now() - interval '7 days')
  union all
  (select o.bucket_id, o.name from storage.objects o
    where o.bucket_id = 'evidence' and o.name like 'takedowns/%' and o.created_at < now() - interval '1 year')
  union all
  (select o.bucket_id, o.name from storage.objects o
    where o.bucket_id in ('private-fonts', 'exports')
      and split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and not exists (select 1 from auth.users u where u.id::text = split_part(o.name, '/', 1)))
  limit least(greatest(coalesce(p_limit, 1), 1), 200);
$$;
revoke all on function public.claim_file_purges(integer) from public, anon, authenticated;
grant execute on function public.claim_file_purges(integer) to service_role;
