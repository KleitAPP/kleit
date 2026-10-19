-- 116 · Affiliate networks as data (spec 16.1 #7 and #9; 4.8): a store's domain maps to a
-- network and a link template, so adding or swapping a network when the applications come
-- through (the owner's, after launch) is a row, not code. Empty until then: buy-redirect sends
-- every tap straight to the store and records the click as 'direct', exactly as before.
--
--   domain         the store's host without "www." ("zara.com"); a tap on a piece from it is rewritten
--   network        the name the click is recorded under ('skimlinks', 'amazon', …)
--   link_template  the address to send the person to: "{url}" is the store address, URL-encoded;
--                  "{raw}" is it as it is. "https://go.skimresources.com/?id=X&url={url}" or
--                  "{raw}?tag=kleit-20".
-- Written by an admin only (logged); read by the server (buy-redirect) and by moderators.
create table public.affiliate_networks (
  domain text primary key constraint affiliate_domain_shape check (domain ~ '^[a-z0-9.-]{3,120}$' and domain not like 'www.%'),
  network text not null constraint affiliate_network_shape check (network ~ '^[a-z0-9_-]{1,32}$'),
  link_template text not null constraint affiliate_template_shape check (link_template ~ '^https://' and (link_template like '%{url}%' or link_template like '%{raw}%')),
  enabled boolean not null default true,
  note text not null default '' constraint affiliate_note_length check (char_length(note) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.affiliate_networks enable row level security;
revoke all on table public.affiliate_networks from anon;
revoke insert, update, delete, truncate on table public.affiliate_networks from authenticated;
create policy "affiliate_networks: moderators read" on public.affiliate_networks for select to authenticated using ((select private.is_moderator()));

alter table public.admin_audit_log drop constraint admin_audit_what;
alter table public.admin_audit_log add constraint admin_audit_what
  check (what in ('dm_evidence', 'user_lookup', 'switch', 'ban', 'unban', 'private_view', 'contest', 'feature', 'invite', 'label', 'network'));

-- The admin's door: set, change or switch off a store's network. Logged with the domain.
create or replace function public.set_affiliate_network(p_domain text, p_network text, p_link_template text, p_enabled boolean default true, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare d text := lower(btrim(coalesce(p_domain, '')));
begin
  perform private.require_admin();
  if d like 'www.%' then d := substr(d, 5); end if;
  insert into public.affiliate_networks (domain, network, link_template, enabled, note, updated_at)
  values (d, lower(btrim(p_network)), btrim(p_link_template), coalesce(p_enabled, true), coalesce(p_note, ''), now())
  on conflict (domain) do update
    set network = excluded.network, link_template = excluded.link_template, enabled = excluded.enabled, note = excluded.note, updated_at = now();
  perform private.admin_note('network', null, d || ' → ' || lower(btrim(p_network)) || case when coalesce(p_enabled, true) then '' else ' (off)' end);
end $$;
revoke all on function public.set_affiliate_network(text, text, text, boolean, text) from public;
grant execute on function public.set_affiliate_network(text, text, text, boolean, text) to authenticated;

-- The server's question at a tap: the network and template for a store, or nothing.
create or replace function public.affiliate_for(p_domain text)
returns table (network text, link_template text)
language sql stable security definer set search_path = '' as $$
  select n.network, n.link_template from public.affiliate_networks n
   where n.enabled and n.domain = case when lower(p_domain) like 'www.%' then substr(lower(p_domain), 5) else lower(p_domain) end;
$$;
revoke all on function public.affiliate_for(text) from public, anon, authenticated;
grant execute on function public.affiliate_for(text) to service_role;
