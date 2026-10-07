-- 050 · TAKE IT DOWN and DMCA requests (roadmap M7.4; spec 13.3 #3–#4, 17.3; technical pack
-- row 49). Both forms work with NO account: the Worker serves the page, the `takedown-request`
-- function (Turnstile, a daily limit per network) writes the row with the service key and hands
-- back a reference. The sender checks progress by reference alone. Moderators resolve: for an
-- intimate image or an infringing picture, the item is removed, its fingerprint joins the
-- never-again list, and every identical copy already stored goes with it.

create table public.takedown_requests (
  id uuid primary key default gen_random_uuid(),
  request_ref text not null unique,
  kind text not null constraint takedown_kind check (kind in ('intimate', 'copyright')),
  name text not null constraint takedown_name_length check (char_length(name) between 1 and 120),
  email text not null constraint takedown_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  urls text[] not null constraint takedown_urls_count check (array_length(urls, 1) between 1 and 20),
  details text not null default '' constraint takedown_details_length check (char_length(details) <= 2000),
  -- DMCA: the work, the good-faith and accuracy statements, the signature (spec 17.3).
  work text not null default '' constraint takedown_work_length check (char_length(work) <= 1000),
  statements boolean not null default false,
  signature text not null default '' constraint takedown_signature_length check (char_length(signature) <= 120),
  ip_hash text,
  state text not null default 'open' constraint takedown_state check (state in ('open', 'removed', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  note text not null default '' constraint takedown_note_length check (char_length(note) <= 500)
);
alter table public.takedown_requests enable row level security;
revoke all on table public.takedown_requests from anon;
revoke insert, delete, truncate on table public.takedown_requests from authenticated;
create policy "takedown_requests: moderators read" on public.takedown_requests for select to authenticated using ((select private.is_moderator()));
create index takedown_open_idx on public.takedown_requests (created_at) where state = 'open';

-- Progress by reference, for the sender with no account: the state and nothing else.
create or replace function public.takedown_status(p_ref text)
returns table (kind text, state text, created_at timestamptz, resolved_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.kind, t.state, t.created_at, t.resolved_at from public.takedown_requests t where t.request_ref = upper(btrim(p_ref));
$$;
revoke all on function public.takedown_status(text) from public;
grant execute on function public.takedown_status(text) to anon, authenticated;

-- Resolving. With an item: that picture goes, its fingerprint is listed, and every stored copy
-- with the same fingerprint goes too (spec 13.3 #3 "identical copies"). Logged.
create or replace function public.takedown_resolve(p_id uuid, p_outcome text, p_note text default '', p_item uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare t public.takedown_requests%rowtype; h text; was text; n integer := 0;
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_outcome not in ('removed', 'rejected') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  select * into t from public.takedown_requests where id = p_id and state = 'open';
  if t.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_outcome = 'removed' and p_item is not null then
    was := coalesce(current_setting('kleit.server_write', true), '');
    perform set_config('kleit.server_write', '1', true);
    select i.image_hash into h from public.items i where i.id = p_item;
    if h is not null then
      insert into public.removed_image_fingerprints (image_hash, reason) values (h, 'takedown:' || t.kind || ':' || t.request_ref) on conflict do nothing;
      update public.items set takedown_state = 'removed' where image_hash = h and takedown_state <> 'removed';
      get diagnostics n = row_count;
    else
      update public.items set takedown_state = 'removed' where id = p_item and takedown_state <> 'removed';
      get diagnostics n = row_count;
    end if;
    perform set_config('kleit.server_write', was, true);
  end if;
  update public.takedown_requests set state = p_outcome, resolved_at = now(), resolved_by = auth.uid(), note = coalesce(p_note, '') where id = p_id;
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (auth.uid(), 'takedown', p_id, null, case when p_outcome = 'removed' then 'remove' else 'dismiss' end,
          coalesce(p_note, '') || case when n > 0 then format(' (%s picture(s) removed)', n) else '' end);
  return n;
end $$;
revoke all on function public.takedown_resolve(uuid, text, text, uuid) from public;
grant execute on function public.takedown_resolve(uuid, text, text, uuid) to authenticated;
