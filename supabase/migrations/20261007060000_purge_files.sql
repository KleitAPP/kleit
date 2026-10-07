-- 057 · Removed pictures leave storage too (CL42; spec 13.3 #3, 14.2). Until now a removal was a
-- row change - `takedown_state = 'removed'` or `deleted_at` - and the file sat in its bucket for
-- ever, because SQL cannot reach storage. A new `purge-files` function (service key, the sweep
-- secret) asks `claim_purges()` for a batch, copies a taken-down picture into the
-- `evidence` bucket first (spec 13.3: evidence is preserved, never shown), deletes the object,
-- and marks the row purged. The nightly cleanup posts to it through pg_net like the sweeper.
--
-- What is purged: a taken-down picture at once (a human decided; nothing is appealable there),
-- and a deleted item's picture 30 days after deletion (the same window as deleted sets, 049).
-- The `clip_records` row stays - it records that the image was once stored and for whom
-- (decision 103); its `image_id` is kept as the record of the path.

alter table public.items add column purged_at timestamptz;
comment on column public.items.purged_at is 'When the stored picture was deleted from its bucket by purge-files (CL42). Server only.';

-- In `public` because PostgREST only serves that schema; callable by the service role alone.
create or replace function public.claim_purges(p_limit integer default 20)
returns table (id uuid, image_bucket public.image_bucket, image_id text, keep_evidence boolean)
language sql security definer set search_path = '' as $$
  select i.id, i.image_bucket, i.image_id, i.takedown_state = 'removed' as keep_evidence
    from public.items i
   where i.image_id is not null
     and i.purged_at is null
     and (i.takedown_state = 'removed'
          or (i.deleted_at is not null and i.deleted_at < now() - interval '30 days'))
   order by i.takedown_state = 'removed' desc, coalesce(i.deleted_at, i.updated_at)
   limit least(greatest(coalesce(p_limit, 1), 1), 100);
$$;
revoke all on function public.claim_purges(integer) from public, anon, authenticated;
grant execute on function public.claim_purges(integer) to service_role;

-- Called by the function after the object is gone. Server only (no auth.uid()).
create or replace function public.mark_purged(p_item uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare was text;
begin
  was := coalesce(current_setting('kleit.server_write', true), '');
  perform set_config('kleit.server_write', '1', true);
  update public.items set purged_at = now() where id = p_item and purged_at is null;
  perform set_config('kleit.server_write', was, true);
end $$;
revoke all on function public.mark_purged(uuid) from public, anon, authenticated;
grant execute on function public.mark_purged(uuid) to service_role;

-- A person never sets or clears purged_at: it joins the server-only columns in the guard.
create or replace function private.items_purged_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.purged_at is distinct from old.purged_at
     and (select auth.uid()) is not null
     and current_setting('kleit.server_write', true) is distinct from '1' then
    raise exception 'purged_at is set by the server only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger items_purged_guard before update on public.items
  for each row execute function private.items_purged_guard();

-- Posts to purge-files. The address is the sweeper's with the name swapped, and the secret is the
-- sweep secret - both from the vault (migration 014), neither ever written in a migration.
create or replace function private.purge_files()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sweep_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sweep_secret' limit 1;
  if v_url is null or v_secret is null then
    raise warning 'purge_files: sweep_url or sweep_secret is not in the vault; nothing purged';
    return;
  end if;
  perform net.http_post(
    url := replace(v_url, '/sweep-images', '/purge-files'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sweep-key', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke all on function private.purge_files() from public, anon, authenticated;

select cron.unschedule('purge-files') where exists (select 1 from cron.job where jobname = 'purge-files');
select cron.schedule('purge-files', '30 9 * * *', $$select private.purge_files()$$);
