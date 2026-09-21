-- Kleit RLS audit (spec §15.2 #3, security plan #3, technical pack §7 #1d and #2).
-- Fails if ANY table in the public schema has Row Level Security switched off,
-- or has RLS on but no policy at all (RLS on + zero policies = locked, which is
-- allowed only for server-only tables; those are listed in the second test).
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every public table has Row Level Security switched on'
);

-- Server-only tables (technical pack §3: rows 3, 6, 11, 61, 62 and others marked
-- "Server only") may have RLS on and no policy. Every other table needs >= 1 policy.
select is(
  (select count(*)::int
     from pg_tables t
    where t.schemaname = 'public'
      and t.tablename not in (
        'blocked_identities', 'removed_image_fingerprints', 'age_confirmations',
        'waitlist_emails', 'asset_licences'
      )
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = t.tablename)),
  0,
  'every public table that is not server-only has at least one policy'
);

select * from finish();
rollback;
