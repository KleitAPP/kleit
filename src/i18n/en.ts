/**
 * Every piece of user-facing text lives here (Lovable knowledge rule 13; spec 20.3 #7).
 * English only at launch. Wording follows design pack §6 — plain, quick, warm; sentence case;
 * no emoji; no "oops"; errors say what happened and what to do next.
 */
export const en = {
  "tabs.home": "Home",
  "tabs.search": "Search",
  "tabs.create": "Create",
  "tabs.inbox": "Inbox",
  "tabs.you": "You",
  "tabs.label": "Main",

  "piece.buyAt": "Buy at {store}",
  "piece.ownItem": "Their own item",
  "piece.from": "from {site}",
  "piece.buyA11y": "Buy {name} at {store}, opens store site",
  "item.own": "OWN",

  "set.by": "by @{username}",
  "set.like": "Like",
  "set.comment": "Comment",
  "set.save": "Save",
  "set.options": "More options",

  "poll.vote": "Vote for {label}",
  "poll.votes": "{count} votes",
  "poll.oneVote": "One vote per device",
  "poll.privacy": "Votes are anonymous. Privacy",

  "sheet.close": "Close",
  "chip.selected": "selected",
  "saved": "Saved",
  "notSaved": "Not saved yet — we'll keep trying. Your work is safe on this phone",
  "loading": "Loading",
  "disclosure.commission": "We earn a commission from purchases",

  "username.title": "Pick your username",
  "username.hint": "This is your link: kleit.app/@{name}",
  "username.label": "Username",
  "username.next": "Next",
  "username.checking": "Checking",
  "username.free": "@{name} is yours",
  "username.taken": "@{name} is taken. Try @{first} or @{second}",
  "username.takenPlain": "@{name} is taken. Try another",
  "username.tooShort": "A bit longer - at least 3 characters",
  "username.tooLong": "A bit shorter - 30 characters at most",
  "username.characters": "Letters, numbers, dots and underscores, and not to start or end",
  "username.offline": "You're offline. We'll check the moment you're back",

  "name.title": "What should we call you?",
  "name.hint": "Your display name. You can change it any time.",
  "name.label": "Display name",
  "name.done": "Done",
  "name.skip": "Skip for now",
  "name.photoLater": "Profile photos arrive with the rest of the picture tools.",

  "welcome.pitch": "Build an outfit, send it to the group chat, see which one wins.",
  "welcome.start": "Get started",
  "welcome.signIn": "Sign in",

  "join.title": "Join Kleit",
  "join.age": "I'm 18 or older and I agree to the {terms} and {guidelines}",
  "join.terms": "Terms",
  "join.guidelines": "Community Guidelines",
  "join.privacy": "Privacy Policy",
  "join.withEmail": "Continue with email",
  "join.usOnly": "Kleit is US only while we're new.",
  "join.failed": "That didn't go through. Try again, or use email instead",
  "join.offline": "You're offline. Sign-up needs a connection",
  "join.testBotCheck": "Test bot check - real keys before the beta",

  "email.title": "What's your email?",
  "email.label": "Email address",
  "email.hint": "We'll send a 6-digit code. No password to remember.",
  "email.send": "Send code",
  "email.badAddress": "That doesn't look like an email address yet",

  "code.title": "Check your email",
  "code.sentTo": "We sent a 6-digit code to {email}",
  "code.change": "Change",
  "code.label": "Digit {n} of 6",
  "code.resend": "Send a new code",
  "code.resendIn": "Send a new code in {seconds}s",
  "code.wrong": "That code doesn't match. Check the newest email",
  "code.expired": "That code has expired. Send a new one",
  "code.tooMany": "Too many tries from this device. Wait a few minutes and send a new code",
  "code.offline": "You're offline. Your code didn't go through",
  "code.unknown": "That didn't go through. Send a new code",

  "launch.checking": "Loading Kleit",

  "update.title": "Update Kleit to keep going",
  "update.body": "This version of Kleit is too old to run. Get the newest one and you're straight back in.",
  "update.action": "Reload Kleit",
  "update.versions": "You have {running}. Kleit needs {minimum}.",

  "maintenance.title": "Kleit is closed for a quick fix",
  "maintenance.body": "Nothing you made is lost. Try again in a few minutes.",
  "maintenance.action": "Try again",
} as const;

export type MessageKey = keyof typeof en;

/** t("piece.buyAt", { store: "Zara" }) → "Buy at Zara" */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text: string = en[key];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
