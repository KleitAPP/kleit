/**
 * S115 — the help centre (roadmap M7.5; spec 21). Short, plain, and honest about what is not
 * built yet. One file, so a search engine or a person can read all of it in a minute; the
 * screen groups them. Keep each answer under a paragraph: if it needs more, the app is wrong.
 */
export type Article = { slug: string; group: Group; title: string; body: string[] };

/** The FAQ's own headings (spec 18.2), in its order, plus People - which the app has and the FAQ does not. */
export const GROUPS = [
  "Getting started",
  "Sets",
  "Closet and clipping",
  "Decoration",
  "Sharing and polls",
  "People",
  "Shopping",
  "Safety",
  "Account",
  "Brands",
] as const;
export type Group = (typeof GROUPS)[number];

export const ARTICLES: Article[] = [
  {
    slug: "what-is-kleit",
    group: "Getting started",
    title: "What is Kleit?",
    body: [
      "Kleit is for putting an outfit together from pieces you clip from any store, or from your own closet, and sending it to friends to vote on - in about a minute. Your friends don't need an account to vote.",
      "It's for people 18 and over, in the US, and it's free.",
    ],
  },
  {
    slug: "first-set",
    group: "Getting started",
    title: "Making your first set",
    body: [
      "Tap the + button and choose Quick set. Pick a template, tap a slot, and choose a piece from your drawer (things you've clipped) or your closet. Add a caption if you like, then Send.",
      "Creative set gives you a free canvas instead: drag, rotate, flip, add words, frames and stickers.",
    ],
  },
  {
    slug: "clip-a-link",
    group: "Closet and clipping",
    title: "Clipping a piece from a store",
    body: [
      "Copy the link to the item from the store's website or app, tap + and choose Clip a link, and paste it. We read the page, show you the pictures on it, and you pick one. The price and store come along when the page says them.",
      "Some stores don't let anything read their pages. When that happens you can still add the piece by hand - name, price and a picture - and the link to the store stays.",
    ],
  },
  {
    slug: "own-photo",
    group: "Closet and clipping",
    title: "Adding your own clothes",
    body: [
      "Tap + and choose Take a photo (or pick one from your phone). Lay the piece on a plain surface in good light. You can cut the background away with the eraser before saving, or keep it.",
      "Every photo is checked by a scanner before anyone else can see it; that usually takes a few seconds. Your closet is private unless you put a piece in a set you share.",
    ],
  },
  {
    slug: "photo-privacy",
    group: "Closet and clipping",
    title: "What happens to my photos?",
    body: [
      "Photos are stripped of location and camera details before they leave your phone, and checked again on our side. We never use your photos to train AI, and we've switched off that option with the scanning provider too.",
      "Your own photos stay yours. If you delete your account, they go with it.",
    ],
  },
  {
    slug: "who-can-see",
    group: "Sharing and polls",
    title: "Who can see my set?",
    body: [
      "Each set has its own setting: Public, Link only, Followers, Friends (people who follow each other), or Only me. New sets are Public and say so plainly on the send screen, with a one-tap switch.",
      "A link to a Public or Link-only set opens for anyone who has it, even without an account. Reset the link from the set's options and the old one stops working at once.",
    ],
  },
  {
    slug: "polls",
    group: "Sharing and polls",
    title: "Which one? polls",
    body: [
      "Pick two to four of your sets and send one link. Anyone with the link votes with two taps and no account; one vote per device. You see totals only - never who voted what. Polls close after seven days unless you pick another time.",
      "If a result looks off, open the poll and tap Look at the votes: each vote shows when it came, which set, and whether it was counted at half (that happens when many votes come from one network). Nobody is named. Hide a vote and the totals change at once; you can put it back any time.",
    ],
  },
  {
    slug: "remix",
    group: "Sets",
    title: "Remixing a set",
    body: [
      'Remix makes your own version of a set you can see: the same layout and the pieces you\'re allowed to use land in a new draft of yours, credited "Remixed from @name". The credit stays on it.',
      "Each set's maker chooses who may remix it - anyone, followers, or no one - from the set's options. Someone's own closet piece only comes along if they've made it shareable.",
    ],
  },
  {
    slug: "song-card",
    group: "Sets",
    title: "Putting a song on a set",
    body: [
      "Open a set you made, tap the … menu and choose Song. Paste the share link of a song from Spotify, Apple Music or YouTube Music; Kleit reads the title, the artist and the cover, and you can fix the words before you keep it. The card shows on the set and on its share page.",
      "Nothing plays inside Kleit. Tapping the card opens the song in that service's own app or site. Only links to those three services work, and the cover always comes from the service itself.",
    ],
  },
  {
    slug: "recently-deleted",
    group: "Sets",
    title: "Recently deleted",
    body: [
      "A deleted set or closet piece waits 30 days in Recently deleted (at the bottom of You, and of your closet) with Restore and Delete now. After 30 days it goes for good on its own.",
      "Deleting a set makes its link stop working at once, but a preview already sent in a chat can't be pulled back.",
    ],
  },
  {
    slug: "lock-down",
    group: "Safety",
    title: "Lock down: every link dead in one tap",
    body: [
      "Settings > Privacy > Lock down turns every set of yours to Only me and gives each a new link, so every link you've ever sent stops working - in chats too - and your open polls close. Nothing is deleted; open sets up again one at a time from Hidden.",
      "Next to it, Make all my sets link-only takes every Public set off your profile and out of search without breaking its links.",
    ],
  },
  {
    slug: "embed-and-extension",
    group: "Sharing and polls",
    title: "Putting a set on a website, and clipping from a computer",
    body: [
      "A set's options include Embed on a website: it copies one line you can paste into a blog or a page, and the embed stops working if you reset the link or make the set private.",
      "On a computer, the Kleit browser extension for Chrome and Edge adds a button to clip the page you're on, or right-click a picture to clip just that.",
    ],
  },
  {
    slug: "for-brands",
    group: "Brands",
    title: "For brands: a look builder on your own site",
    body: [
      'If people clip pieces from your store, Kleit can show a small builder on your site: four slots and the pieces from your store that have been checked, for anyone, with no account. Put this one line on a page, with your store\'s web address in place of the example: <iframe src="https://kleit.app/e/brand/yourstore.com" title="Build a look" style="width:100%;height:900px;border:0"></iframe>',
      "A visitor taps pieces into the slots and, when they tap Keep it on Kleit, the look opens in Kleit as a draft of theirs once they sign in. Nothing is saved for them before that, the page sets no cookies, and it never shows who clipped a piece. A store nobody has clipped from yet shows a line saying so.",
    ],
  },
  {
    slug: "buy-links",
    group: "Shopping",
    title: "Buy buttons and what we earn",
    body: [
      "Buy opens the store in your phone's browser or the store's own app - never inside Kleit. Some stores pay us a small commission when you buy after tapping through; it never changes the price you pay. We say so next to every Buy button.",
    ],
  },
  {
    slug: "following",
    group: "People",
    title: "Following, friends and private accounts",
    body: [
      "Following is one-way. When two people follow each other, you're Friends, and you can share sets with just your friends. A private account approves each follow request. You can remove a follower quietly; they aren't told.",
      "Accounts run by Kleit, by a Kleit stylist or by a brand are labelled as such next to their name - on their profile, on their sets and on the share page - so you always know who is posting.",
    ],
  },
  {
    slug: "challenges",
    group: "People",
    title: "Weekly challenges and the recap",
    body: [
      "A new theme opens every Monday and closes on Friday. Enter one of your public sets from the challenge page; the week's likes decide the order, and Kleit picks a few to show on Home. Badges only, never money.",
      "From Friday to Monday, Home shows the results: Kleit's picks, the three most-liked entries, the most-liked remix of the week, and your own week - sets published, likes received, new followers and pieces saved. Your own numbers are only yours to see. The same page is under Challenges > This week's recap any time.",
    ],
  },
  {
    slug: "messages",
    group: "People",
    title: "Messages and message requests",
    body: [
      "Followers can message you (you choose who, in Settings > Privacy). A first message from someone you don't follow back lands in Message requests, text only, with no read receipts, until you accept. New accounts can't send links for their first week.",
      "You can send a photo with the + button once a conversation is open (not into a request). It is checked the same way as every picture on Kleit, and the other person sees it blurred until they tap it. Taking a message back takes its photo with it.",
      "Messages aren't end-to-end encrypted. If you report a conversation, the last ten messages go with the report so a person can read what was said.",
    ],
  },
  {
    slug: "block-mute-report",
    group: "Safety",
    title: "Blocking, muting and reporting",
    body: [
      "Block (on a profile): they can't find you, see your sets, message, follow, comment, vote or tag you, and any follows are removed both ways. They aren't told. Mute: their sets leave your feed and they aren't told either.",
      "Report is on every set, piece, comment, profile, conversation and group. You get a reference, and you can see where it got to under Settings > Your reports. A person reviews every report; nobody is told who reported them.",
    ],
  },
  {
    slug: "words",
    group: "Safety",
    title: "What can't go in a caption, bio or comment",
    body: [
      "Phone numbers and street addresses: never, in anything public. The screen says so before it saves - it isn't a glitch, and no one has to review it.",
      "Words that reach for eating-disorder or self-harm content: a comment like that is saved where only you can see it and a person looks at it; a caption like that is published but a person looks at it too. If it was a wardrobe purge, they let it through. If you're going through something, the Search tab's help card has people to talk to.",
    ],
  },
  {
    slug: "strikes",
    group: "Safety",
    title: "Strikes and appeals",
    body: [
      "Breaking the community guidelines can earn a strike, which lasts a year. Three live strikes suspend the account. Anything involving a child, an intimate image or a threat suspends at once.",
      "Every strike can be appealed once, in a sentence, under Settings > Strikes and appeals; a different person reviews it within seven days and you are told the outcome. A photo the scanner refused can be appealed from the photo itself, the same way.",
    ],
  },
  {
    slug: "intimate-image",
    group: "Safety",
    title: "Removing an intimate image",
    body: [
      "If an intimate image of you is on Kleit without your consent, use the form at /takedown. No account is needed. We remove it, and every identical copy, within 48 hours, and you get a reference to check on. For copyright problems the form is at /copyright.",
    ],
  },
  {
    slug: "take-a-break",
    group: "Account",
    title: "Taking a break",
    body: [
      "Settings > Take a break hides your profile, sets and comments and keeps everything. Signing in again ends the break and it's all back.",
    ],
  },
  {
    slug: "delete-account",
    group: "Account",
    title: "Deleting your account",
    body: [
      "Settings > Delete account hides everything at once and deletes it for good after seven days; sign in during those days and press Undo to keep it. What stays: other people's remixes of your sets (credited to a deleted account), your votes in poll totals without your name, store pieces you clipped (with no name), and messages you sent, which show as unavailable.",
      "If you can't sign in, the page at /delete-account explains how to ask us to do it for you.",
    ],
  },
  {
    slug: "saved-pieces",
    group: "Shopping",
    title: "Saving pieces and price drops",
    body: [
      "Tap the heart on any piece from a store to save it. Saved pieces sit under You > My items.",
      "About once a week Kleit looks at the store page of each saved piece. If the price has dropped, everyone who saved it is told, and the piece shows the old price crossed out. If the page has gone, Buy stops pointing at it - the piece stays in your sets.",
      "You can turn price-drop pushes off under Settings > Notifications and keep the rest.",
    ],
  },
  {
    slug: "invite-only",
    group: "Getting started",
    title: "Invite codes",
    body: [
      "While Kleit is in its private beta, finishing sign-up needs an invite code. If a friend sent you an invite link, the code is already filled in; otherwise you'll be asked for it after you sign in.",
      "A code is eight letters and digits. If yours isn't accepted, check it with whoever gave it to you - a code can be used only so many times and can end. No code? Ask a friend who's in, or send us a note through the Contact page.",
    ],
  },
  {
    slug: "profile-photo",
    group: "Account",
    title: "Your profile photo",
    body: [
      "On You, tap the circle next to your name to choose a photo from your phone, or to take the one you have off. It shows next to your name everywhere - on your profile, your sets and their share pages - to anyone.",
      "Like every photo on Kleit, it's checked before it shows; that usually takes a few seconds. A photo that can't be used here is simply not shown, and you can choose another.",
    ],
  },
  {
    slug: "download-data",
    group: "Account",
    title: "Downloading your data",
    body: [
      "Settings > Download my data makes one ZIP of everything Kleit holds about you - your profile, sets, folders, closet photos, comments, messages and more - with a link that works for seven days and only for you. One new file a day.",
    ],
  },
  {
    slug: "notifications",
    group: "Account",
    title: "Notifications on your phone",
    body: [
      "Settings > Notifications is a grid: a switch per kind of event for In the app, and - once pushes are on - one for On your phone. A kind turned off in the app leaves your Inbox and its badge. Likes never buzz your phone.",
      "Quiet hours are built in and not a setting: nothing reaches your phone between 10 pm and 8 am your time, a busy hour arrives as one push, and never more than 20 a day. Marketing email is off until you say yes, at the bottom of the same screen.",
    ],
  },
  {
    slug: "cant-sign-in",
    group: "Account",
    title: "If you can't sign in",
    body: [
      "Still have your email? Sign in with it - the code goes there every time, so there's nothing to recover.",
      "Linked Google to your account (Settings > Account > Ways to sign in)? Sign in with that Google account at /recover. That proves it's you; then change your email under Settings > Account.",
      "Neither? Write to us from the email address on the account (the contact form, \"I can't sign in\") and say your username. We check it's yours through that address or a linked Google sign-in before we change anything, never by a username alone. An account nobody can prove is theirs stays as it is - or can be deleted on request.",
      "Linking a second way in now is the surest way never to need this page.",
    ],
  },
  {
    slug: "contact",
    group: "Account",
    title: "Getting in touch",
    body: [
      "Use the form at /contact. Say what happened and, if it's about a report or a takedown, give the reference. We read everything.",
    ],
  },
  {
    slug: "friends-no-app",
    group: "Getting started",
    title: "Do my friends need the app?",
    body: [
      "No. A link to your set opens for anyone, in any browser, with no account: they see the set, can tap Buy, and can vote on a Which one? poll with two taps. They only need an account to make sets of their own, follow you, or comment.",
    ],
  },
  {
    slug: "why-18-us",
    group: "Getting started",
    title: "Why 18 and over, and why only the US?",
    body: [
      "Kleit shows clothes from stores and lets people talk to each other, and we are a very small team. Keeping it to adults and to one country means one set of laws to follow properly - and no guessing about children's privacy rules - rather than many followed badly. Other countries can come later, one at a time.",
      "If you're outside the US you can still open a set someone sends you and vote on it; making an account is the part that waits.",
    ],
  },
  {
    slug: "what-is-a-set",
    group: "Sets",
    title: "What's a set?",
    body: [
      "A set is an outfit put together from pieces: clothes clipped from stores, things from your own closet, or both, on one picture. A Quick set is slots in a template; a Creative set is a free canvas. Every set has a caption, a Who-can-see setting, and a link you can send.",
    ],
  },
  {
    slug: "quick-or-creative",
    group: "Sets",
    title: "Quick set or Creative set?",
    body: [
      "Quick is for speed: pick a template, tap a slot, choose a piece, send. Under a minute, and it always looks tidy. Creative is a canvas: drag, resize, rotate and flip pieces, add words in your own fonts, frames, stickers and backgrounds. Both make a set that shares the same way.",
      "A Quick set can be opened in Creative later if you want to go further with it.",
    ],
  },
  {
    slug: "remove-background",
    group: "Sets",
    title: "Removing a background",
    body: [
      "When you add your own photo, tap the eraser before saving: it cuts the piece out from the background on your phone, and you can tidy the edges by hand. Pictures clipped from stores come as the store shows them. Nothing about a cut-out is kept except the picture itself - no face or body measurements, ever.",
    ],
  },
  {
    slug: "edit-after-sharing",
    group: "Sets",
    title: "Can I edit a set after sharing it?",
    body: [
      "Yes. Open the set and tap Edit; when you save, the same link shows the new version, and the preview updates. Anyone who already has the link sees the newest one. A preview picture already sent in a chat was made at that moment and can't be changed from here.",
    ],
  },
  {
    slug: "version-history",
    group: "Sets",
    title: "Version history",
    body: [
      "Every save of a set is kept: open the set, then Version history, to see your last 20 saves from the last 30 days and restore any of them. Restoring saves it again as the newest version, so nothing is ever lost by going back.",
    ],
  },
  {
    slug: "private-set",
    group: "Sets",
    title: "Making a set private",
    body: [
      "On the send screen, or from the set's options later, choose Only me. The set leaves your profile and search, and its link stops opening for anyone else. Your Only-me sets sit under Hidden on your profile, where you can open one up again any time.",
    ],
  },
  {
    slug: "sources",
    group: "Sets",
    title: "Where's this from? (Sources)",
    body: [
      "Under every set is a Sources line: the store each piece came from, in order. Tap a piece on the set for its own page, with the store, the price as of the last check, and the Buy button that opens the store's page. Pieces from someone's own closet say so instead of naming a store.",
    ],
  },
  {
    slug: "upload-rejected",
    group: "Closet and clipping",
    title: "Why was my upload rejected?",
    body: [
      "The usual reasons, each said on the screen: the picture is smaller than 200 pixels on a side; it is bigger than 10 MB; it is a moving picture (a GIF or a video); or it isn't a picture file at all. Fix the file and try again.",
      "If the scanner refused it, the message says so. It checks every photo for nudity, violence and the like before anyone else can see it, and it can be wrong about a swimsuit or a sculpture. You can appeal from the photo, and a person looks at it. A photo the scanner wants a second look at stays private to you until that look has happened, and you are told the answer either way.",
    ],
  },
  {
    slug: "who-sees-closet",
    group: "Closet and clipping",
    title: "Who can see my closet?",
    body: [
      "Only you. Your closet is private: a piece from it becomes visible to others only when you put it in a set and share that set - and then only that piece, as part of that set. Pieces clipped from stores are different: they join the shared catalogue, with your username next to them as the person who clipped them.",
    ],
  },
  {
    slug: "delete-item",
    group: "Closet and clipping",
    title: "Removing a piece from your closet",
    body: [
      "Open the piece and tap Remove from closet. It leaves your closet now and waits 30 days in Recently deleted, where Restore brings it back. If it is in any of your sets, you choose: keep it in those sets exactly as they are, or remove it from them too, which empties those slots for everyone at once.",
    ],
  },
  {
    slug: "sticker-drawer",
    group: "Decoration",
    title: "What's in the sticker drawer?",
    body: [
      "In Creative mode: stickers and cut-outs, frames, backgrounds and words, sorted into packs by mood - Y2K, deco ballet, and the rest. Everything in it works offline except the museum photographs, which need a connection the first time. Each one has a name, which is what a screen reader says and what the layer list shows.",
    ],
  },
  {
    slug: "where-stickers-come-from",
    group: "Decoration",
    title: "Where do the stickers come from?",
    body: [
      "Two places only: pictures drawn for Kleit by hand, and photographs that museums have placed in the public domain (CC0, free for any use). Nothing is clipped from the web and nothing is generated by AI. Settings > Where the pictures come from lists every museum picture and links to the object it shows.",
    ],
  },
  {
    slug: "recolour",
    group: "Decoration",
    title: "Can I recolour a sticker?",
    body: [
      "Not yet. A sticker comes as it was drawn; you can resize, rotate, flip and layer it, and put words in any colour over it. Recolouring is on the list, with a few other sticker effects, for after launch.",
    ],
  },
  {
    slug: "dark-mode-colours",
    group: "Decoration",
    title: "Why doesn't a flower change colour in dark mode?",
    body: [
      "Because a set is a picture. The app's own screens follow your phone's light or dark setting, but nothing placed on the canvas - a flower, a background, your words - ever changes with it, so a set looks the same to you, to the friend you send it to, and on the share page. The canvas itself stays the same neutral grey in both.",
    ],
  },
  {
    slug: "group-chat",
    group: "Sharing and polls",
    title: "Sending a set to a group chat",
    body: [
      "Tap Send on the set and choose the chat from your phone's share sheet: the link goes in like any other, with a preview. Everyone in the chat can open it without an account. For a vote, make a Which one? poll of two to four sets and send that link instead; the chat votes, you see the totals.",
    ],
  },
  {
    slug: "turn-off-link",
    group: "Sharing and polls",
    title: "Turning off a share link",
    body: [
      "From the set's options, Reset share link gives the set a new link and the old one stops working at once, everywhere it was sent. Setting the set to Only me stops every link to it. And Settings > Privacy > Lock down does that for every set you have in one tap, if you need it.",
    ],
  },
  {
    slug: "price-up-to-date",
    group: "Shopping",
    title: "Is the price up to date?",
    body: [
      "A price is read from the store's page when the piece is clipped, and the page is looked at again about once a week for pieces people have saved. A piece's page says \"Price at [store] as of [date]\", so you can tell how old it is; a piece the store has sold out or taken down is marked. The store's own page is always the last word - the Buy button opens it.",
    ],
  },
  {
    slug: "order-problem",
    group: "Shopping",
    title: "My order has a problem",
    body: [
      "Buy opens the store, and the store takes your order, your payment and your returns - Kleit never does. For anything about an order, write to the store you bought from. If a Buy button on Kleit points at the wrong page or a dead one, tell us and we'll fix the link.",
    ],
  },
  {
    slug: "after-report",
    group: "Safety",
    title: "What happens after I report?",
    body: [
      "You get a reference and the report goes to a person - urgent kinds (a child, an intimate image, a threat) first, within a day; everything else within three. They can dismiss it, remove the thing, give a strike, or suspend the account. Nobody is told who reported them. You can see where each of yours got to under Settings > Your reports.",
    ],
  },
  {
    slug: "copyright-claim",
    group: "Safety",
    title: "Filing a copyright claim",
    body: [
      "If your work is on Kleit without permission, use the form at /copyright - no account needed. Say what the work is, where it is on Kleit, and that you own it or act for the owner; you get a reference to check on. We remove what the claim names, and the person who posted it gets a copyright strike (90 days) with the notice's reference, and can answer with a counter-notice at /counter-notice - no account needed; the picture comes back within 14 days unless you tell us you have sued, and the strike ends with it. The full policy is at /copyright-policy.",
    ],
  },
  {
    slug: "change-email",
    group: "Account",
    title: "Changing your email",
    body: [
      "Settings > Account > Change email. A code goes to the new address, and one to your current address, so nobody can move your account by getting hold of one inbox. The change is done when both codes are in, and your sign-in codes go to the new address from then on.",
    ],
  },
  {
    slug: "phone-number",
    group: "Account",
    title: "Phone numbers",
    body: [
      "Kleit doesn't use phone numbers today. You sign in with your email, and with Google if you link it. Settings > Account shows a phone number as Not added; adding one - only so friends can find you, never for sign-in or texts - comes with finding friends from your contacts, which is not built yet.",
    ],
  },
  {
    slug: "sign-in-alert",
    group: "Account",
    title: "A sign-in you don't recognise",
    body: [
      "Settings > Account > Where you're signed in lists every device signed in to your account, with the one you're on marked. Tap Sign out there on any you don't know: it is out at once. A sign-in code only ever goes to your email, so if someone else got in, secure that inbox next, then write to us if you're still unsure. Kleit doesn't email you about new sign-ins yet; that is coming.",
    ],
  },
  {
    slug: "brands-partner",
    group: "Brands",
    title: "Partnering, advertising or sponsoring a challenge",
    body: [
      "There are no ads on Kleit and no sponsored challenges yet; when there are, every one will be labelled as such and held to the same PG-13 rules as everything else. A brand can already put the look builder on its own site (the For brands article) and have a labelled account. For anything else, write to us from the contact form and choose I'm a brand.",
    ],
  },
];

export function article(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

/** The articles whose title or body carry every word of `query` (case-insensitive); all of them for an empty query. */
export function searchArticles(query: string): Article[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ARTICLES;
  return ARTICLES.filter((a) => {
    const text = `${a.title} ${a.body.join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
