-- 052 · A conversation outlives a deleted member (fix to 051, found by its own test): the
-- members' references were "on delete cascade", so deleting the account deleted the whole
-- conversation out from under the other person - and the cascade that nulled the sender on
-- each message then tripped over the vanished conversation. Now a member becomes "nobody" and
-- the other person keeps the thread, with every line from the deleted account reading
-- "Message unavailable" (spec 3.7 #7).
alter table public.conversations alter column user_a drop not null;
alter table public.conversations alter column user_b drop not null;
alter table public.conversations drop constraint conversations_user_a_fkey;
alter table public.conversations add constraint conversations_user_a_fkey foreign key (user_a) references auth.users (id) on delete set null;
alter table public.conversations drop constraint conversations_user_b_fkey;
alter table public.conversations add constraint conversations_user_b_fkey foreign key (user_b) references auth.users (id) on delete set null;
alter table public.conversations drop constraint conversations_requested_by_fkey;
alter table public.conversations add constraint conversations_requested_by_fkey foreign key (requested_by) references auth.users (id) on delete set null;
