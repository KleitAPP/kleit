-- 053 · Contact messages (roadmap M7.5; spec 13.3 "a way to reach us"). The Worker serves
-- /contact with no account; the `contact-form` function (Turnstile, a daily limit per network)
-- writes the row with the service key and hands back a reference. A signed-in sender's id is
-- kept so a moderator can see which account wrote in. Moderators read the queue and mark a
-- message answered; the reply itself goes by email, outside the app (CL43: no mail sender yet).

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  request_ref text not null unique,
  topic text not null constraint contact_topic check (topic in ('question', 'bug', 'account', 'safety', 'other')),
  name text not null constraint contact_name_length check (char_length(name) between 1 and 120),
  email text not null constraint contact_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  message text not null constraint contact_message_length check (char_length(message) between 1 and 4000),
  user_id uuid references auth.users (id) on delete set null,
  ip_hash text,
  state text not null default 'open' constraint contact_state check (state in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references auth.users (id) on delete set null,
  note text not null default '' constraint contact_note_length check (char_length(note) <= 500)
);
alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from anon;
revoke insert, delete, truncate on table public.contact_messages from authenticated;
create policy "contact_messages: moderators read" on public.contact_messages for select to authenticated using ((select private.is_moderator()));
create index contact_open_idx on public.contact_messages (created_at) where state = 'open';

-- Marking one answered or closed. Moderators only; logged like every other moderator act.
create or replace function public.contact_resolve(p_id uuid, p_outcome text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_outcome not in ('answered', 'closed') then raise exception 'outcome must be answered or closed' using errcode = '22023'; end if;
  update public.contact_messages set state = p_outcome, answered_at = now(), answered_by = auth.uid(), note = coalesce(p_note, '')
   where id = p_id and state = 'open';
  if not found then raise exception 'no open message with that id' using errcode = 'P0002'; end if;
  insert into public.moderation_actions (moderator_id, target_type, target_id, target_user_id, action, note)
  values (auth.uid(), 'contact', p_id, null, 'dismiss', coalesce(p_note, ''));
end $$;
revoke all on function public.contact_resolve(uuid, text, text) from public;
grant execute on function public.contact_resolve(uuid, text, text) to authenticated;
