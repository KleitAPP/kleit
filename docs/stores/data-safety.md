# Store privacy answers — Google Play data safety and the App Store label (draft, M8.6a)

The two store forms ask the same questions in different words. These are the answers for Kleit as
built on 2026-10-10; they must match `ios/App/App/PrivacyInfo.xcprivacy` and the Privacy Policy.
Change all three together. **Draft for the owner to read before either form is filled in (M8.7).**

## Collected, linked to the account, used only to make the app work

| Data | Why | Shared with |
|---|---|---|
| Email address | Sign-in code; account notices | Brevo (sends the email), Supabase (stores it) |
| Name, username, bio | Shown on the profile | Nobody outside the app |
| Photos the person chooses | Their closet and sets; screened for safety | AWS Rekognition (the scan, with AI training opted out), Supabase (storage) |
| Sets, comments, messages, polls, reports | The product | Supabase; OpenAI's moderation endpoint sees comments, captions and bios for the safety check (no account data sent with them) |
| App version and device model | Attached to a contact-form message only | Nobody outside the app |

## Not collected

Precise or approximate location (stripped from every photo before upload) · contacts · browsing
history · health · financial · search history outside the app · device identifiers for advertising.

## Security and deletion (both forms ask)

- Encrypted in transit (TLS everywhere).
- Account deletion in the app (Settings > Delete account, seven days with Undo) and on the web
  (`/delete-account`), as Play's policy requires.
- No tracking, no ads SDK, no analytics SDK (M9 decides on crash reporting; update this if added).

## Play's "Data safety" form, answer by answer

1. Does the app collect or share any required user data types? **Yes.**
2. Is all collected data encrypted in transit? **Yes.**
3. Do you provide a way for users to request deletion? **Yes** (in-app and web link).
4. Data types: Personal info (name, email, user IDs); Photos; Messages (in-app messages);
   App activity (user-generated content). Each: Collected, not shared for advertising, required
   for the feature, used for app functionality.
5. Does the app use the Google Play Families policy? **No** (18+).

## Apple's label (App Store Connect > App Privacy)

Data Linked to You: Contact Info (email, name), User Content (photos, other user content,
messages), Identifiers (user ID). Data Not Linked to You: none. Data Used to Track You: none.
