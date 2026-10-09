-- Migration 072: CL50, the three low findings left by the second review (2026-10-07).
-- Every object here is replaced from its LATEST definition (L31):
--   "closet-photos: owner writes"   from 20260928060000 (the only definition)
--   "messages: members read"        from 20261006000000 (the only definition)
--   public.log_private_view          from 20261006210000 (the only definition)

-- 1. A banned or suspended account cannot put a file in its closet folder. The items row was
--    already refused by refuse_if_banned, but the upload came first and stayed behind as an
--    orphan. Now the bucket refuses too. (clip-url, which writes with the service key, asks
--    profiles.banned_at itself - see its index.ts.)
drop policy "closet-photos: owner writes" on storage.objects;
create policy "closet-photos: owner writes" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'closet-photos'
    and (select private.owns_storage_folder(name))
    and not (select private.is_banned((select auth.uid())))
  );

-- 2. Messages follow their conversation: a member who left, or a block either way, can no
--    longer read the thread by id or over Realtime (Realtime applies this select policy).
--    The rows stay for reports and evidence; moderators read them through the queue functions.
create or replace function private.can_read_conversation(c uuid, who uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select who is not null and exists (
    select 1 from public.conversations x
     where x.id = c
       and (x.user_a = who or x.user_b = who)
       and not private.blocked_either_way(x.user_a, x.user_b)
       and (case when x.user_a = who then x.left_a is null else x.left_b is null end)
  );
$$;
revoke all on function private.can_read_conversation(uuid, uuid) from public;
grant execute on function private.can_read_conversation(uuid, uuid) to authenticated;

drop policy "messages: members read" on public.messages;
create policy "messages: members read" on public.messages for select to authenticated
  using ((select private.can_read_conversation(conversation_id, (select auth.uid()))));

-- 3. log_private_view takes its "what" from a short list. 'dm_evidence' is written only by
--    moderation_queue() itself, so a moderator can no longer write one by hand and silence the
--    queue's own hourly evidence row.
create or replace function public.log_private_view(p_what text, p_target uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_moderator()) then raise exception 'moderators only' using errcode = '42501'; end if;
  if p_what is null or p_what not in ('switch', 'user_lookup', 'private_view') then
    raise exception 'not a loggable view' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required' using errcode = '22023'; end if;
  insert into public.admin_audit_log (admin_id, what, target_id, reason) values (auth.uid(), p_what, p_target, btrim(p_reason));
end $$;
revoke all on function public.log_private_view(text, uuid, text) from public;
grant execute on function public.log_private_view(text, uuid, text) to authenticated;
