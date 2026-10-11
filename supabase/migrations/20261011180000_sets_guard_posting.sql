-- 080 · One correction to 079: its sets_guard was rebuilt from 036's text and lost 048's
-- posting_open check (a grep cut short - L31 again). This is 048's guard plus the two remix
-- credit columns; a new file because 079 is applied.
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
     or new.featured_at is distinct from old.featured_at
     or new.remixed_from_set_id is distinct from old.remixed_from_set_id
     or new.remixed_from_label is distinct from old.remixed_from_label then
    raise exception 'owner_id, takedown_state, share_code, featured_at and the remix credit are set by the server only';
  end if;
  if new.status = 'published' and old.status = 'draft' then
    if coalesce((select s.value::text from public.app_settings s where s.key = 'posting_open'), 'true') <> 'true' then
      raise exception 'posting is paused right now' using errcode = 'P0004';
    end if;
    new.published_at := coalesce(old.published_at, now());
  end if;
  return new;
end;
$$;
