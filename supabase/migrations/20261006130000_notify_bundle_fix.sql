-- 040 · A real bug found by the points test (M6.5): bundling a notification (a second like on
-- the same set within an hour) UPDATES the existing row, and the guard from 031 refuses any
-- change but read_at when a person is signed in - which they always are when they like
-- something. So the second like in an hour was refused outright, from the day 031 landed.
-- Test 025 passed because it bundled as the server, with no signed-in person.
-- The fix: notify() opens the server door for its one update and the guard honours it.

create or replace function private.notifications_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and current_setting('kleit.server_write', true) is distinct from '1'
     and (new.user_id <> old.user_id or new.kind <> old.kind or new.actor_id is distinct from old.actor_id
     or new.ref_id is distinct from old.ref_id or new.bundled_count <> old.bundled_count or new.created_at <> old.created_at) then
    raise exception 'only marking as read is allowed' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.notify(p_user uuid, p_kind text, p_actor uuid, p_ref_type text, p_ref uuid, p_bundle boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
  was text;
begin
  if p_user is null or p_user = p_actor then return; end if;
  if p_actor is not null and (select private.blocked_either_way(p_user, p_actor)) then return; end if;
  if p_bundle then
    select n.id into existing from public.notifications n
     where n.user_id = p_user and n.kind = p_kind and n.ref_id is not distinct from p_ref
       and n.read_at is null and n.updated_at > now() - interval '1 hour'
     order by n.updated_at desc limit 1;
    if existing is not null then
      was := coalesce(current_setting('kleit.server_write', true), '');
      perform set_config('kleit.server_write', '1', true);
      update public.notifications set bundled_count = bundled_count + 1, updated_at = now() where id = existing;
      perform set_config('kleit.server_write', was, true);
      return;
    end if;
  end if;
  insert into public.notifications (user_id, kind, actor_id, ref_type, ref_id)
  values (p_user, p_kind, p_actor, p_ref_type, p_ref);
end $$;
