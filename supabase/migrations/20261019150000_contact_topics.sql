-- Migration 112 (spec 18.1 #4, 13.4 #7, 16.5 #4; the spec walk of 2026-10-19): three more topics
-- on the contact form, so an idea, a brand and a legal request each arrive labelled and can be
-- reviewed as a group instead of being fished out of "Something else".
--   idea  - a feature request (18.1 #4: a form feeding a table, reviewed monthly - this table)
--   brand - a brand asking to partner, advertise or sponsor (16.5 #4)
--   legal - a request from law enforcement or a court (13.4 #7: proper paperwork required; the
--           person concerned is told unless the law forbids it - the words are on the form)
-- The constraint is 053's by name, last replaced in 110.
alter table public.contact_messages drop constraint contact_topic;
alter table public.contact_messages add constraint contact_topic
  check (topic in ('question', 'bug', 'account', 'safety', 'other', 'recovery', 'idea', 'brand', 'legal'));
