-- 108: two more claims through the takedown door (spec 10.5 #2, #4; CL69). An impersonation
-- claim - "this account is pretending to be me / my brand" - with up to two photos of an ID,
-- kept in the private `id-verification` bucket (044: "kept 30 days and deleted; nobody in the
-- app, ever") and purged thirty days after the claim whatever its outcome; and a trademark
-- claim, which carries the mark and registration in `work`, the statements and a signature like
-- a DMCA notice. Both are rows of takedown_requests: the same no-account form door, the same
-- reference to check on, the same moderator queue and log. The moderator's action on a person
-- (a rename, a label, a suspension) is the /mod/users tools; resolving the claim here records
-- the decision and tells the sender.
--
-- The photos are the only thing new in kind: they are read by moderators through a function
-- that signs a two-minute address (`id-photo`), never by a bucket policy, and purge-files
-- removes them when claim_id_purges says they are due.

alter table public.takedown_requests drop constraint takedown_kind;
alter table public.takedown_requests add constraint takedown_kind
  check (kind in ('intimate', 'copyright', 'impersonation', 'trademark'));

alter table public.takedown_requests add column id_paths text[] not null default '{}'
  constraint takedown_id_paths_count check (coalesce(array_length(id_paths, 1), 0) <= 2);
alter table public.takedown_requests add column id_purged_at timestamptz;
create index takedown_id_purge_idx on public.takedown_requests (created_at)
  where id_purged_at is null and id_paths <> '{}';

-- What purge-files asks each night: ID photos past thirty days. Server only.
create or replace function public.claim_id_purges(p_limit integer default 20)
returns table (id uuid, paths text[])
language sql security definer set search_path = '' as $$
  select t.id, t.id_paths
    from public.takedown_requests t
   where t.id_purged_at is null
     and t.id_paths <> '{}'
     and t.created_at < now() - interval '30 days'
   order by t.created_at
   limit least(greatest(coalesce(p_limit, 1), 1), 100);
$$;
revoke all on function public.claim_id_purges(integer) from public, anon, authenticated;
grant execute on function public.claim_id_purges(integer) to service_role;

create or replace function public.mark_id_purged(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.takedown_requests set id_purged_at = now(), id_paths = '{}' where id = p_id and id_purged_at is null;
$$;
revoke all on function public.mark_id_purged(uuid) from public, anon, authenticated;
grant execute on function public.mark_id_purged(uuid) to service_role;

-- The sender's status check says the kind; the answer times differ (48 h intimate, 72 h the rest).
-- takedown_status is unchanged: it already returns the kind as text.
