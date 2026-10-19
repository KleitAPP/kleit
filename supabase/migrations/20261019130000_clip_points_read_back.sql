-- 111 · The read-back of 102 (L35): the clipper's point is given only for a piece that is still
-- live and cleared (a deleted, taken-down or re-blocked clip earns nothing), and never more than
-- twenty times a day to one clipper - a second account publishing set after set with somebody's
-- clips on them would otherwise hand that somebody 5,000 × 4 points for nothing. 102's text
-- (the one definition - L31) plus the two guards.
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
         and i.deleted_at is null and i.takedown_state = 'none'
         and exists (select 1 from public.item_flags f where f.item_id = i.id and f.scan_state = 'clean')
    loop
      if (select count(*) from public.points_ledger l
           where l.user_id = c.clipper and l.reason = 'clip_used' and l.created_at > now() - interval '1 day') >= 20 then
        continue;
      end if;
      perform private.award(c.clipper, 1, 'clip_used', new.id::text || ':' || c.item_id::text);
    end loop;
  end if;
  return new;
end $$;
