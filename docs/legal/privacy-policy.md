# Kleit Privacy Policy

**DRAFT v0.1 — 2026-09-21 — for the owner's review and the flat-fee lawyer review (spec 17.1, 17.2 #2). Not yet in force. Not legal advice.** Built from the data map in master spec 14.2. [Bracketed] items are filled in when the company exists.

Effective date: [date] · Version: [version]

## The short version
1. **We don't sell your data.** We don't show ads based on you.
2. **We don't train AI on your photos**, and we create **no face or body measurements**.
3. Your **closet is private** unless you change it; your **email is never shown** to anyone.
4. You can **download everything** and **delete your account** at any time.
5. Kleit is for **adults (18+) in the United States**.

## 1. Who we are
Kleit is run by [Company], [address]. Contact us about privacy at [privacy email / support email].

## 2. What we collect, why, and how long we keep it
| What | Why | Kept |
|---|---|---|
| Your email address | Sign-in codes, account and security notices | While your account is open |
| Your sign-in provider ID (Apple or Google) | Signing you in | While your account is open; we revoke Apple's token when you delete |
| Username, display name, bio, profile photo | Your public profile | While your account is open |
| Your confirmation that you're 18+, the Terms version and the time | Proof of agreement and of the age gate | While your account is open **and 1 year after** deletion |
| Your phone number, **only if you add one** | Letting friends find you — never for sign-in or marketing texts | While your account is open; we match using a scrambled (hashed) copy |
| Clothing photos you upload | Your closet and sets | Until you delete them; location data (GPS) is removed from photos before upload and again on our servers |
| Pictures and details you clip from stores | Your sets and the shared catalogue | The catalogue item stays after you leave but is no longer linked to you; the link back to the source page stays |
| A **clip record** (who clipped a picture, when, and from which page) | Ties every stored picture to the person who saved it | While the picture is stored |
| Your sets, comments, likes, collections, follows | The service you asked for | While your account is open |
| Direct messages | Chat | While your account is open. **Messages are not end-to-end encrypted.** Moderators read a conversation only if someone reports it |
| Poll votes, with a scrambled device ID and IP address | One vote per device; stopping vote-rigging | Raw IP 30 days; scrambled device ID 90 days |
| Buy-button taps, with a random click ID | Getting paid commission by stores | Raw 90 days, then totals only. Never your name or email |
| Signed-in devices and approximate city | "Where you're signed in" and security alerts | While the session is active |
| Contacts, **only if you use Find friends** | Suggesting friends | **Compared and discarded — never stored** |
| Private fonts you upload | Text on your own sets | Until you delete them; shared sets show a picture of the text, never the font file |
| App usage events and crash reports | Fixing bugs and improving Kleit | Usage events 13 months; crash reports the shortest period the vendor allows |
| Reports and moderation records | Safety and legal obligations | 2 years (child-safety evidence 1 year, locked) |
| Support emails | Helping you | 2 years |

We don't ask for your birthday, and we never create face measurements or other biometric data. Background removal on your phone creates no face data.

## 3. Who we share it with
We share data only with the services that run Kleit for us, under data-processing agreements, and only for the purpose listed:
Supabase (database, sign-in, storage — US), Cloudflare (website, images, bot check), Amazon Web Services (automatic photo safety check — we have opted out of AWS using our photos to improve its services), Google Cloud (photo search and text-in-image checks), OpenAI (automatic text safety check; it keeps no data), Resend (email), Twilio (phone verification text, only if you add a number), OneSignal (push notifications — location off, anonymous ID only), PostHog (usage analytics — IP storage off), Sentry (crash reports), Help Scout (support), Apple and Google (sign-in), and affiliate networks and stores (a random click ID when you tap Buy).
We also share information when the law requires it (with proper legal process), to protect people's safety, or with a company that takes over Kleit (we'd tell you first). We report child sexual abuse material to the National Center for Missing & Exploited Children as the law requires.

## 4. What other people can see
Your username, display name, profile photo, bio and the sets you make public. You choose who can see each set: Public, Link-only, Followers, Friends or Only me. Drafts and "Only me" sets are never visible to anyone else. Your closet is private by default. Your email is never shown. A **private account** lets you approve followers. **Link-only sets open for anyone who has the link**, and previews already sent in chats can't be pulled back.

## 5. Your choices and rights
1. **Download your data** any time (Settings → Download my data): a ZIP with your sets, closet photos, profile, comments, likes, follows and messages.
2. **Delete your account** (Settings → Delete account, or kleit.app/delete-account without signing in). Everything is hidden right away; after 7 days it is permanent. Stored files are purged within 30 more days, and backups roll off within 7–30 days. Your comments are removed; your votes stay in totals but are no longer linked to you; messages you sent show "Message unavailable"; **remixes other people made of your public sets stay**.
3. **Control** who can find you by email or phone, whether you're suggested to others, notifications and quiet hours, and who can message, tag or remix you.
4. **Your Privacy Choices / Global Privacy Control:** we don't sell or share personal data for targeted advertising. If ads ever come, we'll honour the Global Privacy Control signal. We don't respond to "Do Not Track" signals because there is no agreed standard; we don't track you across other sites anyway.
5. Depending on your state, you may have rights to access, correct or delete your data. Ask at [privacy email] and we'll respond within the time the law requires.

## 6. Visitors without an account
If someone sends you a set, you can open it, tap Buy, and vote on its poll without an account. We use an invisible bot check (Cloudflare Turnstile) and a scrambled device ID so each device votes once. **We do no behaviour tracking of visitors outside the United States.**

## 7. Children
Kleit is for people 18 and older. We don't knowingly collect data from anyone under 18. If we learn an account belongs to someone under 18, we lock it and delete it (and its data) after 7 days unless the person shows they're 18+. Parents can contact [support email]. In the phone apps we also use Apple's and Google's age signals.

## 8. Security
Data is encrypted in transit and at rest. Every database table has row-level access rules, so accounts can only reach what they're allowed to. Staff access to private data requires a reason and is logged. No system is perfectly secure; if a breach affects you, we'll tell you as the law requires, and within 30 days.

## 9. Where your data is
In the United States.

## 10. Changes
If we change this policy in a significant way, we'll tell you by email and in the app at least 30 days before it takes effect.

## 11. Contact
[privacy email] · [Company], [address].
