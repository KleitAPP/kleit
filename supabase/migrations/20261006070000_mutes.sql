-- 034 · Mute (roadmap M5.5; spec 10.4 #5): hides someone from your feed; they are not told.
-- The feed arrives at M6 and reads this table; until then it is the switch and the list.
create table public.mutes (
  muter_id uuid not null references auth.users (id) on delete cascade,
  muted_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint mutes_not_self check (muter_id <> muted_id)
);
alter table public.mutes enable row level security;
revoke all on table public.mutes from anon;
revoke update, truncate on table public.mutes from authenticated;
create policy "mutes: owner reads" on public.mutes for select to authenticated using (muter_id = (select auth.uid()));
create policy "mutes: owner mutes" on public.mutes for insert to authenticated with check (muter_id = (select auth.uid()));
create policy "mutes: owner unmutes" on public.mutes for delete to authenticated using (muter_id = (select auth.uid()));

create or replace function private.is_muted(p_by uuid, p_who uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mutes m where m.muter_id = p_by and m.muted_id = p_who);
$$;
revoke all on function private.is_muted(uuid, uuid) from public;
grant execute on function private.is_muted(uuid, uuid) to authenticated;

-- The muted list for Settings, with names (the muted person's profile stays visible to you).
create or replace function public.muted_people()
returns table (user_id uuid, username text, display_name text, muted_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username, p.display_name, m.created_at
    from public.mutes m join public.profiles p on p.user_id = m.muted_id
   where m.muter_id = auth.uid()
   order by m.created_at desc;
$$;
revoke all on function public.muted_people() from public;
grant execute on function public.muted_people() to authenticated;
