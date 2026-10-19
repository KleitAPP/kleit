# Kleit Cookie Notice

**DRAFT v0.1 — 2026-10-19 — for the owner's review and the flat-fee lawyer review (spec 14.4 #2, 19 #14). Not yet in force. Not legal advice.** Written from what the site and the app actually store today; it is updated the day anything on this list changes.

Effective date: [date] · Version: [version]

## The short version
1. **Kleit's own code sets no cookies.** Not on the app, not on a shared set page, not on a poll. Cloudflare, which serves the site, may set its own short-lived bot-protection cookie (`__cf_bm`, about 30 minutes) on some visits; it tells a person from a bot and nothing else.
2. We keep a few things **in your own browser's storage** so the app works - your sign-in, a copy of your closet for when you're offline, and one random ID so a poll counts your device once.
3. There is **no advertising tracking** and **no analytics** on Kleit today. If that ever changes, this notice changes first, and US law doesn't require a cookie banner for a site without targeted ads.

## 1. What is stored in your browser, and why
| What | Where | Why | How long |
|---|---|---|---|
| Your sign-in session | Browser storage (localStorage) | So you stay signed in | Until you sign out, or the session ends |
| The screen you were heading to, and an invite code you typed, while you sign in | Browser storage for this tab only (sessionStorage) | So sign-in brings you back where you were | Until the tab closes |
| A copy of your closet, your sets and the drawn decorations, and edits made offline waiting to send | Browser storage (IndexedDB) | So the app opens and works when you're offline | Replaced as things change; cleared on sign-out |
| One random device ID (`kleit_device`) | Browser storage, on poll pages | So each device votes once on a poll - it is never tied to your name | Until you clear your browser's storage |
| Which permission explanations you've already seen, whether we've asked you to rate the app, and the last account that signed in on this device | Browser storage | So we explain and ask once, and so the offline copy knows whose it is | Until you clear the app's storage |

None of these are cookies: nothing is sent to us with every request, and nothing follows you to another site.

## 2. Services that run on our pages
1. **Cloudflare** serves kleit.app and runs the **Turnstile** bot check on sign-up, on the public forms (contact, takedown, copyright, counter-notice, impersonation, trademark) and behind poll votes. Cloudflare may also set the `__cf_bm` cookie above. Turnstile is built not to track people across sites; Cloudflare's own privacy policy covers what it processes to tell a person from a bot.
2. **Supabase** hosts the database, the sign-in system and the stored pictures; the sign-in session above is theirs by name (`sb-…-auth-token`).
3. **No analytics, no crash reporter and no advertising tags** are loaded today. The plan names PostHog (usage numbers) and Sentry (crash reports) for later; when either is switched on it will be listed here with what it stores and for how long, and visitors outside the US will not be measured on shared pages.

## 3. Buy links
When you tap **Buy**, Kleit records that a Buy button was tapped (which piece, in which set, and - once we have one - which affiliate network), never who tapped it, and sends you to the store's own website or app. The store, and any affiliate network in between, may set their own cookies on their own sites. Those are theirs, under their notices, not ours.

## 4. Your choices
You can clear everything above by signing out (the sign-in session and the offline copy) or by clearing the site's data in your browser's settings. Clearing the device ID means a poll you already voted on could count this device again; that is the only effect.

## 5. Changes
We change this notice before we change what's stored, and the version and date at the top move when we do.

## 6. Contact
[privacy email] · [Company], [address].
