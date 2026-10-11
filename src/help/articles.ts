/**
 * S115 — the help centre (roadmap M7.5; spec 21). Short, plain, and honest about what is not
 * built yet. One file, so a search engine or a person can read all of it in a minute; the
 * screen groups them. Keep each answer under a paragraph: if it needs more, the app is wrong.
 */
export type Article = { slug: string; group: string; title: string; body: string[] };

export const GROUPS = [
  "Getting started",
  "Sets and sharing",
  "Your closet",
  "People",
  "Safety",
  "Your account",
] as const;

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
    group: "Your closet",
    title: "Clipping a piece from a store",
    body: [
      "Copy the link to the item from the store's website or app, tap + and choose Clip a link, and paste it. We read the page, show you the pictures on it, and you pick one. The price and store come along when the page says them.",
      "Some stores don't let anything read their pages. When that happens you can still add the piece by hand - name, price and a picture - and the link to the store stays.",
    ],
  },
  {
    slug: "own-photo",
    group: "Your closet",
    title: "Adding your own clothes",
    body: [
      "Tap + and choose Take a photo (or pick one from your phone). Lay the piece on a plain surface in good light. You can cut the background away with the eraser before saving, or keep it.",
      "Every photo is checked by a scanner before anyone else can see it; that usually takes a few seconds. Your closet is private unless you put a piece in a set you share.",
    ],
  },
  {
    slug: "photo-privacy",
    group: "Your closet",
    title: "What happens to my photos?",
    body: [
      "Photos are stripped of location and camera details before they leave your phone, and checked again on our side. We never use your photos to train AI, and we've switched off that option with the scanning provider too.",
      "Your own photos stay yours. If you delete your account, they go with it.",
    ],
  },
  {
    slug: "who-can-see",
    group: "Sets and sharing",
    title: "Who can see my set?",
    body: [
      "Each set has its own setting: Public, Link only, Followers, Friends (people who follow each other), or Only me. New sets are Public and say so plainly on the send screen, with a one-tap switch.",
      "A link to a Public or Link-only set opens for anyone who has it, even without an account. Reset the link from the set's options and the old one stops working at once.",
    ],
  },
  {
    slug: "polls",
    group: "Sets and sharing",
    title: "Which one? polls",
    body: [
      "Pick two to four of your sets and send one link. Anyone with the link votes with two taps and no account; one vote per device. You see totals only - never who voted what. Polls close after seven days unless you pick another time.",
      "If a result looks off, open the poll and tap Look at the votes: each vote shows when it came, which set, and whether it was counted at half (that happens when many votes come from one network). Nobody is named. Hide a vote and the totals change at once; you can put it back any time.",
    ],
  },
  {
    slug: "remix",
    group: "Sets and sharing",
    title: "Remixing a set",
    body: [
      'Remix makes your own version of a set you can see: the same layout and the pieces you\'re allowed to use land in a new draft of yours, credited "Remixed from @name". The credit stays on it.',
      "Each set's maker chooses who may remix it - anyone, followers, or no one - from the set's options. Someone's own closet piece only comes along if they've made it shareable.",
    ],
  },
  {
    slug: "recently-deleted",
    group: "Sets and sharing",
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
    group: "Sets and sharing",
    title: "Putting a set on a website, and clipping from a computer",
    body: [
      "A set's options include Embed on a website: it copies one line you can paste into a blog or a page, and the embed stops working if you reset the link or make the set private.",
      "On a computer, the Kleit browser extension for Chrome and Edge adds a button to clip the page you're on, or right-click a picture to clip just that.",
    ],
  },
  {
    slug: "buy-links",
    group: "Sets and sharing",
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
      "Breaking the community guidelines can earn a strike, which lasts a year. Three live strikes suspend the account. Anything involving a child, an intimate image or a threat suspends at once. Every strike can be appealed once, in a sentence, and a different person reviews it within seven days.",
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
    group: "Your account",
    title: "Taking a break",
    body: [
      "Settings > Take a break hides your profile, sets and comments and keeps everything. Signing in again ends the break and it's all back.",
    ],
  },
  {
    slug: "delete-account",
    group: "Your account",
    title: "Deleting your account",
    body: [
      "Settings > Delete account hides everything at once and deletes it for good after seven days; sign in during those days and press Undo to keep it. What stays: other people's remixes of your sets (credited to a deleted account), your votes in poll totals without your name, store pieces you clipped (with no name), and messages you sent, which show as unavailable.",
      "If you can't sign in, the page at /delete-account explains how to ask us to do it for you.",
    ],
  },
  {
    slug: "saved-pieces",
    group: "Your closet",
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
    slug: "download-data",
    group: "Your account",
    title: "Downloading your data",
    body: [
      "Settings > Download my data makes one ZIP of everything Kleit holds about you - your profile, sets, folders, closet photos, comments, messages and more - with a link that works for seven days and only for you. One new file a day.",
    ],
  },
  {
    slug: "notifications",
    group: "Your account",
    title: "Notifications on your phone",
    body: [
      "In the app, Settings > Notifications turns pushes on and lets you choose which kinds reach your phone. Likes never buzz your phone, nothing arrives between 10 pm and 8 am your time, a busy hour arrives as one push, and never more than 20 a day.",
    ],
  },
  {
    slug: "contact",
    group: "Your account",
    title: "Getting in touch",
    body: [
      "Use the form at /contact. Say what happened and, if it's about a report or a takedown, give the reference. We read everything.",
    ],
  },
];

export function article(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
