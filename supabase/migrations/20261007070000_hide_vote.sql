-- 058 · The poll owner can hide a vote (spec 7.3 #9; CL29). Totals stay totals - nobody is named -
-- but the owner may now look at the votes one by one: when, which option, whether it was counted
-- at half (a network burst, spec 7.3 #6), whether the voter was signed in, whether a friend. No
-- hash, no id, no name ever leaves the table. Hiding flips `votes.hidden`, which `poll_totals`
-- and `shared_poll` already skip; unhiding puts it back. Only the poll's owner may do either.

create or replace function public.my_poll_votes(p_poll uuid, p_limit integer default 500)
returns table (id uuid, option_id uuid, created_at timestamptz, weight numeric, hidden boolean, signed_in boolean, is_friend boolean)
language sql stable security definer set search_path = '' as $$
  select v.id, v.option_id, v.created_at, v.weight, v.hidden,
         v.voter_id is not null,
         v.voter_id is not null and (select private.are_friends(v.voter_id, p.owner_id))
    from public.votes v
    join public.polls p on p.id = v.poll_id
   where v.poll_id = p_poll
     and p.deleted_at is null
     and p.owner_id = (select auth.uid())
   order by v.created_at desc
   limit least(greatest(coalesce(p_limit, 1), 1), 2000);
$$;
revoke all on function public.my_poll_votes(uuid, integer) from public, anon;
grant execute on function public.my_poll_votes(uuid, integer) to authenticated;

create or replace function public.hide_vote(p_vote uuid, p_hidden boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.votes v set hidden = p_hidden, updated_at = now()
    from public.polls p
   where v.id = p_vote and p.id = v.poll_id and p.deleted_at is null and p.owner_id = (select auth.uid());
  if not found then raise exception 'not your poll, or no such vote' using errcode = '42501'; end if;
end $$;
revoke all on function public.hide_vote(uuid, boolean) from public, anon;
grant execute on function public.hide_vote(uuid, boolean) to authenticated;
