-- Migration 002 — app_settings (roadmap M1.14; technical pack §1.9, §3 row 53, §6A; design pack G8).
-- The emergency switches and the minimum app version. Everyone may READ them — the launch
-- check (S1) runs before anyone signs in — and only an admin may change them.

create table public.app_settings (
  key text primary key
    constraint app_settings_known_key check (key in (
      'min_app_version', 'maintenance_mode', 'signups_open', 'posting_open',
      'dms_open', 'comments_open', 'public_links_open')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.app_settings enable row level security;
revoke insert, update, delete, truncate on table public.app_settings from anon;

create trigger app_settings_touch before update on public.app_settings
  for each row execute function private.touch_updated_at();

-- Permissions row 53: anyone reads; admin creates, changes, deletes.
create policy "app_settings: anyone reads" on public.app_settings
  for select to anon, authenticated
  using (true);

create policy "app_settings: admins insert" on public.app_settings
  for insert to authenticated
  with check ((select private.is_admin()));

create policy "app_settings: admins update" on public.app_settings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy "app_settings: admins delete" on public.app_settings
  for delete to authenticated
  using ((select private.is_admin()));

insert into public.app_settings (key, value) values
  ('min_app_version', '"0.0.0"'),
  ('maintenance_mode', 'false'),
  ('signups_open', 'true'),
  ('posting_open', 'true'),
  ('dms_open', 'true'),
  ('comments_open', 'true'),
  ('public_links_open', 'true');
