-- 078 · Push, three rules from spec 12.1 that 073 left out: a like is in-app only and never a
-- push (#2); each person chooses which kinds reach their phone (#6 - the "settings grid", as a
-- list of kinds turned off, so a new kind is on until they say otherwise); and a daily limit
-- (#4) - at most 20 pushes a day to one person, however busy their sets are.

alter table public.push_settings add column muted_kinds text[] not null default '{}';
comment on column public.push_settings.muted_kinds is 'Notification kinds the person does not want as a push; everything else is on (spec 12.1 #6).';

create or replace function private.push_enqueue() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_muted text[];
begin
  if coalesce((select s.value::text from public.app_settings s where s.key = 'push_open'), 'false') <> 'true' then return new; end if;
  -- Likes are in-app only (spec 12.1 #2); the strike and report answers reach people in the app too.
  if new.kind in ('like', 'strike', 'report_resolved', 'appeal_decided') then return new; end if;
  select s.muted_kinds into v_muted from public.push_settings s where s.user_id = new.user_id and s.enabled;
  if not found then return new; end if;
  if new.kind = any (v_muted) then return new; end if;
  if (select private.is_hidden_account(new.user_id)) then return new; end if;
  if new.read_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.bundled_count <= old.bundled_count then return new; end if;
    if exists (select 1 from public.push_queue q where q.notification_id = new.id and q.state in ('pending', 'claimed')) then return new; end if;
    if exists (select 1 from public.push_queue q where q.notification_id = new.id and q.state = 'sent' and q.sent_at > now() - interval '1 hour') then return new; end if;
  end if;
  -- The daily limit: twenty a day to one person, counting what is waiting as well as what went.
  if (select count(*) from public.push_queue q
       where q.user_id = new.user_id and q.state in ('pending', 'claimed', 'sent') and q.created_at > now() - interval '24 hours') >= 20 then
    return new;
  end if;
  insert into public.push_queue (user_id, notification_id, kind, ref_type, ref_id, due_at)
  values (new.user_id, new.id, new.kind, new.ref_type, new.ref_id, private.push_due_at(new.user_id));
  return new;
end $$;
