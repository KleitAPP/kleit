-- 054 · The contact form attaches what the sender's device is (design pack S116: "attaches user
-- ID, app version, device"). The page sends the browser's own description and the app version
-- it was opened from; nothing a person typed. Up to 300 characters, kept with the message so a
-- bug report can be reproduced.
alter table public.contact_messages
  add column client text not null default '' constraint contact_client_length check (char_length(client) <= 300);
