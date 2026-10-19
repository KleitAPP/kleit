# Screen-reader test scripts (spec 21 #12)

Five key flows, run by a person with VoiceOver (iPhone) and TalkBack (Android) on the test
site, before each store submission and after any change to the screens named here. The
automatic checks (axe in the core loop, the 200 % text check) catch what a machine can; these
catch what only a listener can: order, names, and whether a change is said.

How to run: turn the reader on (iPhone: Settings → Accessibility → VoiceOver; Android: Settings
→ Accessibility → TalkBack), open the test site in the phone's browser or the app, and go
through each script with the screen covered or the curtain on (VoiceOver: three-finger triple
tap; TalkBack: the "screen curtain" in the TalkBack menu). Every line that starts with "Hear:"
is a pass/fail; write what was actually said when it differs. Record the phone, the OS version,
the reader's version and the date at the top of the run.

A flow passes when every "Hear:" line is heard in that order, nothing needs a drag or a long
press that the reader cannot do, and nothing important is said only by colour, position or an
unlabelled icon.

---

## 1. Sign in with a code, then the first screen

1. Open `/welcome`. Hear: the page title, "Kleit", the one-line pitch ("Build an outfit, send
   it to the group chat..."), then "Get started" and "Sign in" as buttons.
2. "Get started". Hear: "Join Kleit", the 18+ line with "Terms" and "Community Guidelines" as
   links, then "Continue with email" and "Continue with Google" as buttons; the invisible bot
   check is never announced as a field or a puzzle.
3. Continue with email, type one, submit. Hear: "Check your email", "We sent a 6-digit code
   to ...", then the first box as "Digit 1 of 6".
4. Paste the code (the boxes accept a paste or autofill; nothing has to be typed digit by
   digit). Hear: the digits, then the next screen's heading - "Pick your username" for a new
   account, "Home" for a known one.
5. New account: type a username. Hear: the "Username" field, then "@name is yours" or "@name is
   taken. Try ..." once it settles - said once, not on every keystroke - then "Display name".

Fail if: the code has to be typed one box at a time; a captcha appears as a thing to solve;
the availability line is silent or repeats.

## 2. Build a quick set and send it

1. From Home, the tab bar. Hear: five tabs by name, the current one said as "selected" - never
   only by colour.
2. "Create" → "Quick set". Hear: "Slot 1, empty. Tap to pick a piece." through slot 4, each a
   button.
3. Activate slot 1. Hear: the picker opens as a dialog, with tabs "Recent clips", "Closet",
   "My items", "Search"; the first tab is selected.
4. Choose a piece. Hear: the piece's name and its colour word ("black boots, Zara"), then back
   on the builder "Slot 1: black boots". The OWN tag, when present, is a word, not a badge.
5. "Caption or question" field, then "Send". Hear: "Send it", the title, "Who can see it" as a
   group with the current choice stated, then "Publish".
6. After Publish. Hear: the link itself (kleit.../s/...), then "Copy link" and "Send to a chat"
   as buttons; after Copy link, "Copied".

Fail if: a slot is only "button"; the picker's chosen piece is not confirmed by name; the
privacy choice is a row of coloured pills with no state; the link is not read.

## 3. The Creative canvas without a drag

1. Open a Creative set. Hear: "Creative set", then the hidden list "Layers on the canvas" with
   each layer as "Layer 1: black boots, Zara", in order from the bottom.
2. Activate a layer in the list. Hear: the layer's name, "pressed", and the button panel:
   "Left", "Right", "Up", "Down", "Bigger", "Smaller", "Rotate" (twice, left then right),
   "Flip", "Forward", "Back", "Lock", "Hide", "Remove" - all buttons by name.
3. Press Left three times quickly. Hear: ONE announcement, "Moved 30 pixels left" - not three.
4. "Add text". Hear: the new layer in the list ("Layer 3: Text: Your words here") and the text
   panel: the words field, the font group, the size and alignment buttons, "Behind the words"
   with Nothing / Scrim / Strip / Blur (Scrim pressed), and the colour group with colour NAMES
   (Ink, Paper, Rose ...), never a swatch alone.
5. Lock the layer. Hear: "Locked" said once; the move buttons now "dimmed" / "disabled".
6. "Add a decoration". Hear: the drawer as a dialog; each tile by the asset's own name (a
   museum title for a cutout, a plain name for a drawing); pack tabs by name.

Fail if: a layer is only "button"; nudges are said one by one; a colour is only "button";
a decoration tile is "image" with no name.

## 4. The shared page as a stranger (signed out)

1. Open a `/s/<code>` link in the browser. Hear: the page title with the set's name, then the
   heading (level 1), the owner's name, the caption.
2. Read on. Hear: the set's alt text as one sentence ("A set by @name with 3 pieces: ...");
   each piece as "Piece 1: name, price, store" and its "Buy at <store>" link; the affiliate
   disclosure line before the first Buy; decorations by name.
3. Text on the set. Hear: the words, in the set's order; nothing about the box behind them.
4. The end of the page. Hear: "Open Kleit" and the legal links (Terms, Privacy, Copyright,
   Accessibility) as links by name; the footer never traps focus.
5. A poll link (`/p/<code>`). Hear: each option as a button with its label and, after a vote,
   the result as "Option A: 60 percent, 3 votes" - the number, not only a bar.

Fail if: headings are skipped (no level 1); a Buy is "link" only; a poll result is only a
bar; the page scrolls sideways at 200 % text.

## 5. Report something, then an urgent alert for a moderator (two phones)

1. On a set, "Report". Hear: "Report this" as a dialog, "What's wrong?", the reasons by name
   (each a pressable option, the chosen one stated), the optional note field, "Send report".
2. Send. Hear: "Report sent", "Your reference:" and the K- reference, then "Done".
3. Settings → "Your reports". Hear: the report by reference and reason, its state as a word
   ("Open", "Resolved").
4. On the moderator's phone, with an urgent report filed (reason: underage, intimate image or
   self-harm): the push arrives. Hear: "An urgent report is waiting in the review queue" and
   that opening it lands on the queue.
5. In the queue. Hear: each report as its reference, when it was filed, "Urgent" as a word,
   "Due in N h", the reason and the reported person; a picture as "Show the picture" (a
   button) - nothing is shown until that button; the four actions by name; after a decision,
   "Done." and the list refreshed. After two hours of decisions: "Time for a break" and the
   time the queue opens again, read before any button.

Fail if: a reason is only a coloured chip; the reference is not read; a picture is shown
without the button; "Urgent" is only red.

---

## Recording a run

Copy this block into `claude/status-<date>.md` (or hand it to the developer) once per phone:

```
Phone / OS / reader: iPhone 12, iOS 18.x, VoiceOver   or   Pixel 4a, Android 13, TalkBack 15
Date, site build: 2026-xx-xx, kleit-test @ <commit>
Flow 1: pass / fail - what was said instead
Flow 2: ...
Flow 3: ...
Flow 4: ...
Flow 5: ...
```

Anything that fails becomes a line in `claude/open-problems.md` with the words that were heard.
