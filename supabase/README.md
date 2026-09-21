# supabase/

- `migrations/` — every database change, one file each, `YYYYMMDDHHMMSS_what_it_does.sql`, applied to **kleit-test** by the `database` GitHub Action. Never type SQL into the dashboard; never let Lovable write a migration. Every file that creates a table also enables RLS and writes its policies in the same file (technical pack §6 #3, §6A).
- `functions/` — edge functions (secrets live in Supabase secret storage, never here).
- `tests/database/` — pgTAP RLS tests, run by `supabase test db --linked` after every database change. A failing test blocks the waypoint.
