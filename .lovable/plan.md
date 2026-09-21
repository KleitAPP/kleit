# Noindex tag, plus finding the failed-build error text

## 1. The failed build — what I can and cannot see from here

In this workspace the project builds cleanly. The build record for the current
code says, word for word:

```text
=== build 2026-09-21T11:00:15Z ===
build OK
```

So the app code itself is not what failed. I do not have access to the run log
of that GitHub push, so I cannot quote its error text word for word yet.

What the push added points at one likely source: `.github/workflows/database.yml`
runs on every push that touches `supabase/`, and that push did touch it. That
workflow logs in to the database project and applies migrations, using two
secrets pasted in GitHub (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`).
If those are not set, or the `supabase/migrations/` folder does not exist yet,
that run fails — while the app build stays green. This is an unconfirmed
diagnosis; the run log settles it.

To get the exact wording, open the failed run on GitHub (Actions tab, the run
named "database" on commit "M1.1: publishable key, folder layout, database CI…"),
open the red job, and paste the error lines here. I will then tell you the exact
text and, if the fix belongs in one of the files from that push, name the file
before changing anything.

No change to `.env`, and no migration, table or edge function, in any case.

## 2. Add the noindex tag

Edit only `src/routes/__root.tsx`: add one entry to the existing site-wide
`meta` array —

```tsx
{ name: "robots", content: "noindex, nofollow" }
```

This puts the tag in the head of every page, so the whole test site stays out
of search results. Nothing else in the file changes.

## Verification

- Confirm the build record reads "build OK" after the edit.
- Load the preview and confirm it still shows only "Kleit" centred.
- Read the rendered page head and confirm the robots tag is present.
