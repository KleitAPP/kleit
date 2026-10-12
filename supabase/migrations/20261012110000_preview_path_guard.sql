-- 097 · The server-code review (2026-10-12; L32 for the functions this time): `set-preview`
-- removed whatever file `sets.preview_image_id` named, with the service key, and the column was
-- the owner's to write - so a path copied from somebody else's `og:image` would have had the
-- function delete that person's chat picture. The function now removes only a file under its
-- own set's folder; and here the column becomes the server's, on the way in and out (the app
-- never writes it - set-preview does, with the service key). sets_insert_guard and sets_guard
-- are 095's text plus this one change (L31).
create or replace function private.sets_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin())
     or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.remixed_from_set_id is not null or new.remixed_from_label is not null
     or new.featured_at is not null or new.takedown_state <> 'none' then
    raise exception 'the remix credit, featured_at and takedown_state are set by the server only' using errcode = '42501';
  end if;
  -- The chat picture is drawn and named by the server; a row never arrives pointing at a file.
  new.preview_image_id := null;
  if new.status = 'published' then
    if coalesce((select s.value::text from public.app_settings s where s.key = 'posting_open'), 'true') <> 'true' then
      raise exception 'posting is paused right now' using errcode = 'P0004';
    end if;
    new.published_at := now();
  else
    new.published_at := null;
  end if;
  return new;
end;
$$;

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
  if new.preview_image_id is distinct from old.preview_image_id then
    raise exception 'the chat picture is drawn and named by the server (set-preview)' using errcode = '42501';
  end if;
  if new.published_at is distinct from old.published_at and not (new.status = 'published' and old.status = 'draft') then
    raise exception 'published_at is stamped by the server' using errcode = '42501';
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
