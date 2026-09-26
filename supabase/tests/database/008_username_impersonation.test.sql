-- Tests for migration 009 (roadmap M1.7). Every name here came out of an independent test that
-- walked past migration 008's twelve-word list. Rolled back at the end; nothing is kept.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

-- The phishing set: the names a scam would use to sound like our own support desk.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['kleitsecurity','kleitsafety','kleittrust','kleitmoderator','kleitbilling',
                       'kleitpassword','kleitlogin','kleitsignin','kleitreset','kleitrecovery',
                       'kleitnotice','kleitalerts','kleitupdates','kleitcontact','kleitpress',
                       'kleitrefund','kleitinvoice','kleitverify','kleitappeal','kleitabuse',
                       'kleit.password.reset','security.kleit']) as n),
  'names that sound like our support desk are refused');

-- The same, spelled with lookalike characters.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['k1eitpassw0rd','k1eit.secur1ty','kle17.b1lling','k1eit_l0gin']) as n),
  'lookalike spellings of those are refused too');

-- Our name wrapped in one ordinary word and nothing else.
select ok(
  (select bool_and(username_status(n) = 'reserved')
     from unnest(array['mykleit','thekleit','getkleit','joinkleit','trykleit','kleitco','kleitinc',
                       'kleitcorp','kleitgroup','kleitmod','kleitpay','kleitmail','kleitinfo',
                       'kleitstore','kleitshop','kleitdotcom','my.kleit','kleit.co']) as n),
  'our name wrapped in one ordinary word is refused');

-- And the whole point of the relax: ordinary handles that merely CONTAIN those letters are free.
select ok(
  (select bool_and(username_status(n) = 'free')
     from unnest(array['kleitman','kielty','kleitfan','kleitmodel','kleitcore','kleitmoda',
                       'kleitpayday','kleitmailbox','kleitcollective','kleitclub.house',
                       'kleitshopper','kleitgroupie','kleitinformal','lovekleit','kleitish']) as n),
  'ordinary handles that merely contain those letters are still free');

-- Handles with none of our name in them are untouched by any of this.
select ok(
  (select bool_and(username_status(n) = 'free')
     from unnest(array['jaywears','ellie.fits','securityblanket','passwordless','mymood',
                       'thestore','payday','mailbox']) as n),
  'handles without our name are untouched');

select is(username_status('ab'), 'shape', 'shape rules still come first');

select * from finish();
rollback;
