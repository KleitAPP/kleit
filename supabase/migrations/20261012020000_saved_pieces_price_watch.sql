-- 088 · Saved pieces and price drops (spec 11 #4 "price-drop alerts on saved items"; the feature
-- list's "price tracking and dead-link repair"; S39 "My items"). Hearting a catalogue piece
-- writes a `saved_items` row - that table has waited since 010 for a screen. Then a timer reads
-- each saved piece's store page about once a week: a lower price tells everyone who saved it
-- (kind `price_drop`), a higher one is simply recorded, a page that is gone twice marks the
-- piece so Buy stops pointing at a dead address. Stores that refuse (WA2) just stay unchecked.
--
-- Replaced from their latest definitions (L31): items_guard (047 = 20261006200000, the newest of five).

-- 1. A save is of a cleared product the person can see, never of a draft of anyone's own photo.
drop policy "saved_items: owner creates" on public.saved_items;
create policy "saved_items: owner creates" on public.saved_items
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.items i where i.id = saved_items.item_id and i.kind = 'product' and i.deleted_at is null and i.takedown_state = 'none')
  );
create index saved_items_item_idx on public.saved_items (item_id);

-- 2. What the watch remembers on the piece. The server's columns, like the price itself is not.
alter table public.items add column price_was_cents integer check (price_was_cents is null or price_was_cents >= 0);
alter table public.items add column price_check_fails integer not null default 0;
alter table public.items add column dead_link_at timestamptz;
comment on column public.items.price_was_cents is 'The price before the last drop the watch saw (migration 088); null once the price rises again.';
comment on column public.items.dead_link_at is 'Set when the store page answered gone twice (migration 088): Buy stops pointing at it.';

create or replace function private.items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or (select private.is_admin()) or current_setting('kleit.server_write', true) = '1' then
    return new;
  end if;
  if new.source_url is distinct from old.source_url
     or new.image_hash is distinct from old.image_hash
     or new.takedown_state is distinct from old.takedown_state
     or new.owner_id is distinct from old.owner_id
     or new.image_bucket is distinct from old.image_bucket
     or new.price_was_cents is distinct from old.price_was_cents
     or new.price_check_fails is distinct from old.price_check_fails
     or new.dead_link_at is distinct from old.dead_link_at then
    raise exception 'source_url, image_hash, takedown_state, owner_id, image_bucket and the price watch''s columns are set by the server only';
  end if;
  return new;
end;
$$;

alter table public.notifications drop constraint notifications_kind;
alter table public.notifications add constraint notifications_kind
  check (kind in ('vote', 'comment', 'like', 'follow', 'follow_request', 'message_request', 'message', 'group_invite',
                  'ask_answer', 'ask_chosen', 'contest_results', 'report_resolved', 'strike', 'appeal_decided', 'remix', 'mention', 'tag',
                  'poll_results', 'contest_pick', 'price_drop'));
alter table public.notifications drop constraint notifications_ref_type;
alter table public.notifications add constraint notifications_ref_type
  check (ref_type in ('set', 'poll', 'conversation', 'profile', 'group', 'ask', 'contest', 'report', 'strike', 'item'));

-- 3. The watch hands out pieces: saved by somebody, with a store address, not checked for a
--    week, not given up on. Claimed by stamping the check time, so two runs never share one.
create or replace function public.claim_price_checks(p_limit integer default 8)
returns table (id uuid, source_url text, price_cents integer, price_currency text)
language sql security definer set search_path = '' as $$
  with due as (
    select i.id from public.items i
     where i.kind = 'product' and i.source_url is not null and i.deleted_at is null
       and i.takedown_state = 'none' and i.dead_link_at is null and i.price_check_fails < 5
       and (i.price_checked_at is null or i.price_checked_at < now() - interval '7 days')
       and exists (select 1 from public.saved_items s where s.item_id = i.id)
     order by i.price_checked_at asc nulls first
     limit greatest(1, least(coalesce(p_limit, 8), 50))
     for update skip locked
  )
  update public.items i set price_checked_at = now()
    from due where i.id = due.id
  returning i.id, i.source_url, i.price_cents, i.price_currency;
$$;
revoke all on function public.claim_price_checks(integer) from public, anon, authenticated;
grant execute on function public.claim_price_checks(integer) to service_role;

-- 4. What the read found. 'ok' with a price: lower → remembered as a drop and everyone who saved
--    the piece is told once; higher or first → recorded quietly. 'no-price': the page read but
--    said nothing. 'blocked': the store refused (five in a row and the piece is left alone).
--    'gone': 404/410 - twice and the piece is marked, so Buy no longer points at the page.
create or replace function public.record_price_check(p_item uuid, p_status text, p_cents integer default null, p_currency text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare it public.items%rowtype; told integer := 0; s record;
begin
  if (select auth.uid()) is not null then raise exception 'server only' using errcode = '42501'; end if;
  if p_status not in ('ok', 'no-price', 'blocked', 'gone') then raise exception 'unknown status' using errcode = '22023'; end if;
  select * into it from public.items i where i.id = p_item;
  if it.id is null then return 0; end if;
  if p_status = 'ok' and p_cents is not null and p_cents >= 0 then
    if it.price_cents is not null and p_cents < it.price_cents then
      update public.items set price_was_cents = it.price_cents, price_cents = p_cents,
             price_currency = coalesce(p_currency, price_currency), price_check_fails = 0, price_checked_at = now()
       where id = p_item;
      for s in select user_id from public.saved_items where item_id = p_item loop
        perform private.notify(s.user_id, 'price_drop', null, 'item', p_item, false);
        told := told + 1;
      end loop;
    elsif it.price_cents is null or p_cents > it.price_cents then
      update public.items set price_was_cents = null, price_cents = p_cents,
             price_currency = coalesce(p_currency, price_currency), price_check_fails = 0, price_checked_at = now()
       where id = p_item;
    else
      update public.items set price_check_fails = 0, price_checked_at = now() where id = p_item;
    end if;
  elsif p_status in ('ok', 'no-price') then
    update public.items set price_check_fails = 0, price_checked_at = now() where id = p_item;
  elsif p_status = 'blocked' then
    update public.items set price_check_fails = price_check_fails + 1, price_checked_at = now() where id = p_item;
  else
    update public.items set price_check_fails = price_check_fails + 1, price_checked_at = now(),
           dead_link_at = case when price_check_fails + 1 >= 2 then coalesce(dead_link_at, now()) else dead_link_at end
     where id = p_item;
  end if;
  return told;
end $$;
revoke all on function public.record_price_check(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_price_check(uuid, text, integer, text) to service_role;

-- 5. The timer: pg_net posts to the function with the sweep secret (as the purge, 057), hourly
--    at :17. Eight pieces a run; a piece comes round again after a week.
create or replace function private.watch_prices()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'sweep_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sweep_secret' limit 1;
  if v_url is null or v_secret is null then
    raise warning 'watch_prices: sweep_url or sweep_secret is not in the vault; nothing checked';
    return;
  end if;
  perform net.http_post(
    url := replace(v_url, '/sweep-images', '/price-watch'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sweep-key', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end $$;
revoke all on function private.watch_prices() from public, anon, authenticated;

select cron.unschedule('price-watch') where exists (select 1 from cron.job where jobname = 'price-watch');
select cron.schedule('price-watch', '17 * * * *', $$select private.watch_prices()$$);
