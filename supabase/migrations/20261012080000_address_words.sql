-- 094 · More street words for the address rule (spec 13.2 #4). The owner's own test bio on the
-- test site reads like an address ending in "cir" (circle) and a ZIP, and the rule from 062 let
-- it through: its list of street types had no circle, crescent, plaza, square or trail. The
-- shape of the rule is the same - a number, one to four words, a street type - so a caption like
-- "3 looks for the trail" is now refused too; the person sees "no phone numbers or addresses"
-- and rewords, which is the right side to err on for public words.
--
-- Replaced from its latest definition (L31): text_verdict (062, the only one).

create or replace function public.text_verdict(p_text text, p_kind text default 'comment')
returns text language plpgsql immutable security definer set search_path = '' as $$
declare t text := lower(coalesce(p_text, '')); ph text;
begin
  if t = '' then return 'ok'; end if;
  -- A phone number (US shapes) or a street address: never in public words (spec 13.2 #4).
  if p_kind in ('caption', 'bio', 'comment') then
    if t ~ '(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}' then return 'refuse'; end if;
    if t ~ '\m\d{1,6}\s+[a-z0-9.''-]+(\s+[a-z0-9.''-]+){0,3}\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|terrace|ter|parkway|pkwy|highway|hwy|circle|cir|crescent|cres|plaza|plz|square|sq|trail|trl)\M\.?' then return 'refuse'; end if;
  end if;
  foreach ph in array private.held_phrases() loop
    if t ~ ('\m' || regexp_replace(ph, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '\M') then return 'hold'; end if;
  end loop;
  return 'ok';
end $$;
