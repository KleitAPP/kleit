# Store listing — the words and pictures for the App Store and Google Play (draft, M8.7)

Drafted 2026-10-11 from the app as built. **For the owner to read and change before either
console is filled in**; nothing here is final until he says so. Every claim below is a feature
that exists today - nothing promised (spec 20.4 #6: claim only what is tested). The Polyvore name
appears nowhere in the listing, by rule (guardrail 8).

Character limits are the stores' own (checked 2026-10-11): Apple name 30, subtitle 30,
promotional text 170, keywords 100, description 4,000; Google title 30, short description 80,
full description 4,000.

## 1. Names and the one-line pitch

| Field                                        | Text                                                                                                                                                     | Count |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| App name (both)                              | `Kleit`                                                                                                                                                  | 5     |
| Apple subtitle                               | `Build an outfit. Send it. Vote`                                                                                                                         | 30    |
| Google short description                     | `Build an outfit from real clothes, send it to the group chat, see who wins.`                                                                            | 76    |
| The one-sentence pitch (press, landing page) | _Kleit is the fast way to put an outfit together from real clothes - yours and the stores' - and send it to your friends to vote on, in about a minute._ | —     |

## 2. Promotional text (Apple, 170; can change without a new build)

`Clip a piece from any store, add what you own, drop them on a set and send the link. Friends vote on their phones - no account needed to see it or vote.` (152)

## 3. Description (both stores; Google takes the same text)

**Which one? Ask the group chat.**

Kleit is where you put an outfit together and let your friends pick. Clip a piece from a store
page, add a photo of something you own, drop them onto a set, and send the link. The people you
send it to see the set and vote on their phones. They don't need an account for that.

**Clip from anywhere**
Paste a link from any store and Kleit pulls the picture, the price and where it's from. The
source link stays on the piece, always.

**Your own closet**
Snap a photo of a piece you own. The background comes off on the phone - nothing is sent anywhere
to do it - and you can tidy the edges with your finger. Your closet is private unless you say
otherwise.

**Quick or creative**
Quick mode is three or four pieces on a template, done in under a minute. Creative mode is a
canvas: move, resize, rotate, layer, add words and a background, and reach into a library of
hundreds of decorations - museum photographs and hand-drawn pieces, from Victorian scrap to Y2K.

**Send it, then see what they think**
Every set gets a link that opens as a clean page in any chat. Make a poll from two to four sets
and watch the votes come in. Totals only, never who voted what.

**Buy what you like**
Each clipped piece keeps its Buy link to the store. We earn a commission from purchases; the
price you pay is the same.

**Find people who dress like you**
Follow people, comment, remix a set into your own version, ask the community for help with a
piece, and enter the weekly challenge.

**Yours to keep, yours to delete**
Download everything you've made as one file whenever you like. Deleted sets and closet pieces wait
30 days in Recently deleted, and deleting your account deletes it.

Kleit is for people 18 and over, in the United States, at launch.

## 4. Keywords (Apple, 100 characters, commas, no spaces, no repeats of the name)

`outfit,outfits,closet,wardrobe,style,fashion,collage,lookbook,clothes,shopping,vote,poll,stylist` (96)

## 5. Categories and ratings

| Store  | Primary   | Secondary | Age                                                                                                                                                                                                                 |
| ------ | --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple  | Lifestyle | Shopping  | **18+** on Apple's age-rating questionnaire (user-generated content, unrestricted messaging between members, shopping links); Declared Age Range on (M8.6)                                                          |
| Google | Lifestyle | —         | IARC questionnaire: **declare** users interact (comments, messages), share user-generated content, and that the app has shopping links; no gambling, no violence, no drugs; **18+** in Play's own age signal (M8.6) |

Apple's "Does your app contain unrestricted web access?" - **No** (store pages open in the phone's
own browser, not inside the app).

## 6. URLs the forms ask for

| Field                             | Until the domain stage                                        | After                              |
| --------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| Support                           | `https://kleit-test.kleitapp-team.workers.dev/help`           | `https://kleit.app/help`           |
| Marketing                         | `https://kleit-test.kleitapp-team.workers.dev/welcome`        | `https://kleit.app`                |
| Privacy policy                    | `https://kleit-test.kleitapp-team.workers.dev/settings/legal` | `https://kleit.app/privacy`        |
| Delete account (Play requires it) | `https://kleit-test.kleitapp-team.workers.dev/delete-account` | `https://kleit.app/delete-account` |

The stores will not accept a workers.dev address for a published app's privacy policy; these are
placeholders for TestFlight and internal testing only. The domain stage (OW7) replaces them.

## 7. Screenshots (shot list)

Apple wants the 6.9" iPhone set (1320 × 2868) and the 13" iPad set; Google wants phone
screenshots (at least two, 16:9 to 9:16) and a **feature graphic 1024 × 500**. One sentence of
large text above each picture, on the Studio paper, never a device frame.

| #   | Screen                                                                      | Caption                                |
| --- | --------------------------------------------------------------------------- | -------------------------------------- |
| 1   | A shared set as a friend sees it in a chat - the set, Buy at Zara, the vote | **Send an outfit. Let them vote.**     |
| 2   | The Quick builder with three pieces in and the caption being typed          | **Three pieces. One minute.**          |
| 3   | The closet, with one tile mid-cutout (the eraser)                           | **Your closet, cut out on the phone.** |
| 4   | The Creative canvas with a Balletcore decoration being placed               | **Or go all the way.**                 |
| 5   | A poll with the bars filling in                                             | **Totals, never names.**               |
| 6   | The weekly challenge board                                                  | **This week's challenge.**             |

Feature graphic (Google): the mark in white on the brick accent, left; on the right in white,
`Which one? Ask the group chat.` No screenshot inside it.

## 8. App Review notes (Apple; a similar note goes in Play's "instructions for review")

> Kleit is for adults (18+) in the United States. Sign-in is by a 6-digit email code; the
> reviewer account below has a fixed code so no mailbox is needed. The account is filled with
> sets, a poll, a conversation and a closet so every screen has content.
>
> Reviewer sign-in: `review@kleit.app` — code `000000` _(to be made at M10; not a real account today)_.
>
> The app bundles the web app and adds native features: on-device background removal (Vision
> framework), an offline closet and offline editing with sync, push notifications (OneSignal),
> and permission primers before every system prompt. Buy links open the store in Safari; we earn
> a commission from purchases, and the app says so beside every Buy button.
>
> Photos are screened automatically before anyone else can see them, and every image carries a
> report option. Account deletion is in Settings, with seven days to undo.

## 9. Accessibility labels (Apple; claim only what is tested)

Tested on the web build with VoiceOver's equivalents (screen reader, 200% text, reduce motion,
no drag required - design pack §8.3): **VoiceOver**, **Larger Text**, **Reduced Motion**,
**Sufficient Contrast**. Claim the rest (Voice Control, Switch Control, captions) only after a
run on the phone at M8.G.

## 10. What is not claimed, and why

- **The share extension** (M8.2, saving from a store app's share sheet) - not built yet; the
  description says "paste a link", which is what exists.
- **Photo search** ("style this piece") - M10.
- **Apple and Google sign-in** - the code paths exist, but the company developer accounts (needed
  for Sign in with Apple) do not; the listing says "sign-in by email code".
