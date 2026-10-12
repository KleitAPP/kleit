-- 102 · Five small promises of the spec's catalogue sections, found by walking them against the
-- code (2026-10-12): a colour to search by (9 #1; the colour itself is named by the phone and
-- the clipper, spec 4.4 #4), "sold out" from the price watch (4.8 #1), the soft caps on sets and
-- closet pieces (4.6 #5), and a point for the clipper when somebody else's set uses their clip
-- (4.3 #4). Each function is replaced from its latest text (L31) with the one change.

-- 1. Search by colour. A colour is one of sixteen words - the same sixteen the app's chips show
--    and the clipper names a picture with - so the filter means what the chip says and nothing
--    else can be written into the column (it feeds the search vector, 030). Nothing wrote a colour
--    before today; a stray value would simply be forgotten. Then the function: the four-argument
--    shape goes, or PostgREST would have two to choose from on every call that leaves the new
--    argument out (the same reason 087 dropped an overload).
update public.items set color_name = null
 where color_name is not null
   and color_name not in ('black', 'white', 'grey', 'cream', 'brown', 'tan', 'red', 'pink', 'orange', 'yellow', 'green', 'olive', 'teal', 'blue', 'navy', 'purple');
alter table public.items add constraint items_colour_check
  check (color_name is null or color_name in ('black', 'white', 'grey', 'cream', 'brown', 'tan', 'red', 'pink', 'orange', 'yellow', 'green', 'olive', 'teal', 'blue', 'navy', 'purple'));
drop function public.search_items(text, text, integer, integer);
create or replace function public.search_items(q text, p_store text default null, p_max_cents integer default null, p_limit integer default 40, p_colour text default null)
returns setof public.items language sql stable security invoker set search_path = '' as $$
  select i.* from public.items i
   where i.kind = 'product'
     and i.deleted_at is null
     and i.takedown_state = 'none'
     and (private.search_query(q) is null or i.search @@ private.search_query(q))
     and (p_store is null or i.source_domain = p_store or i.store_name = p_store)
     and (p_max_cents is null or (i.price_cents is not null and i.price_cents <= p_max_cents))
     and (p_colour is null or i.color_name = p_colour)
   order by (case when private.search_query(q) is null then 0 else ts_rank(i.search, private.search_query(q)) end) desc, i.created_at desc
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.search_items(text, text, integer, integer, text) from public;
grant execute on function public.search_items(text, text, integer, integer, text) to authenticated;
create index items_colour_idx on public.items (color_name) where color_name is not null;

-- 2. Sold out, from the price watch: the page reader now says whether the store page offers the
--    piece, and the watch passes it on. Unknown leaves the flag as it was; a page that is gone
--    says nothing about stock. The four-argument shape goes for the same reason as above.
drop function public.record_price_check(uuid, text, integer, text);
create or replace function public.record_price_check(p_item uuid, p_status text, p_cents integer default null, p_currency text default null, p_sold_out boolean default null)
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
  -- Stock, when the page said: a reading, never a guess.
  if p_status in ('ok', 'no-price') and p_sold_out is not null then
    update public.items set sold_out = p_sold_out where id = p_item and sold_out is distinct from p_sold_out;
  end if;
  return told;
end $$;
revoke all on function public.record_price_check(uuid, text, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.record_price_check(uuid, text, integer, text, boolean) to service_role;

-- 3. The soft caps (spec 4.6 #5): 5,000 sets and 3,000 closet pieces per account. A member's
--    insert past the cap is refused with its own code; the server and an admin are not capped.
--    The numbers can be lowered for a test with `kleit.sets_cap` / `kleit.closet_cap`.
create or replace function private.sets_cap() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap integer := coalesce(nullif(current_setting('kleit.sets_cap', true), '')::integer, 5000);
begin
  if (select auth.uid()) is null or (select private.is_admin()) then return new; end if;
  if (select count(*) from public.sets s where s.owner_id = new.owner_id and s.deleted_at is null) >= cap then
    raise exception 'That is as many sets as one account can hold (%). Delete some to make room.', cap using errcode = 'P0012';
  end if;
  return new;
end $$;
drop trigger if exists sets_cap on public.sets;
create trigger sets_cap before insert on public.sets for each row execute function private.sets_cap();

create or replace function private.closet_cap() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap integer := coalesce(nullif(current_setting('kleit.closet_cap', true), '')::integer, 3000);
begin
  if (select auth.uid()) is null or (select private.is_admin()) then return new; end if;
  if (select count(*) from public.closet_items c where c.user_id = new.user_id and c.deleted_at is null) >= cap then
    raise exception 'That is as many closet pieces as one account can hold (%). Remove some to make room.', cap using errcode = 'P0013';
  end if;
  return new;
end $$;
drop trigger if exists closet_cap on public.closet_items;
create trigger closet_cap before insert on public.closet_items for each row execute function private.closet_cap();

-- 4. A point for the clipper (spec 4.3 #4): when a set is published, every store piece on it that
--    somebody else clipped earns its clipper one point, once per set and piece. Given at publish,
--    not at placement, so a draft nobody sees earns nobody anything. 039's text plus the loop.
alter table public.points_ledger drop constraint points_ledger_reason_check;
alter table public.points_ledger add constraint points_ledger_reason_check
  check (reason in ('publish', 'like_received', 'follower', 'contest_entry', 'clip_used'));
create or replace function private.points_on_publish() returns trigger language plpgsql security definer set search_path = '' as $$
declare n integer; c record;
begin
  if new.status = 'published' and old.status = 'draft' then
    perform private.award(new.owner_id, 10, 'publish', new.id::text);
    select count(*) into n from public.sets s where s.owner_id = new.owner_id and s.status = 'published' and s.deleted_at is null;
    if n >= 1 then perform private.badge(new.owner_id, 'first_set'); end if;
    if n >= 10 then perform private.badge(new.owner_id, 'ten_sets'); end if;
    if n >= 125 then perform private.badge(new.owner_id, 'style_icon'); end if;
    for c in
      select i.owner_id as clipper, i.id as item_id
        from public.set_items si join public.items i on i.id = si.item_id
       where si.set_id = new.id and i.kind = 'product' and i.owner_id is not null and i.owner_id <> new.owner_id
    loop
      perform private.award(c.clipper, 1, 'clip_used', new.id::text || ':' || c.item_id::text);
    end loop;
  end if;
  return new;
end $$;
