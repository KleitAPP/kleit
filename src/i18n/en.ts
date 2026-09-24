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
