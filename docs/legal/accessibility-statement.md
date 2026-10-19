# Kleit Accessibility Statement

**DRAFT v0.1 — 2026-10-19 — for the owner's review (spec 21 #14; 20.4 #6: claim only what has been tested). Not yet in force.** Written from what the checks in the repository prove today; it is updated when a gap below closes or a new one is found.

Effective date: [date] · Version: [version]

## The short version
Kleit aims to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA, in the app and on every page of kleit.app. Today it **partly conforms**: most of the app meets it and is checked automatically after every change; the Creative canvas and the phone apps' screen-reader testing are the open work, listed plainly below.

## 1. What is built and checked
1. **Every control can be used without a mouse or a drag.** A selected piece on the canvas has buttons to nudge, resize, rotate, flip and reorder it, and keyboard shortcuts for the same; nothing needs a drag.
2. **Tap targets are at least 48 pixels** on every screen, and the visible focus ring is never hidden.
3. **Colour never carries a meaning alone:** colour names sit beside swatches, poll results are written as numbers, "sold out" and "own" are words, a chosen chip has a tick, and the current tab has a label.
4. **Contrast** of every text colour is at least 4.5:1 in both the light and the dark theme, checked by a script on every change.
5. **Text size follows your settings.** Every size is in relative units, so a larger browser or phone text size makes cards taller rather than cutting words off.
6. **Reduced motion is respected:** nothing animates on its own, loading placeholders stop shimmering, and notices fade rather than slide.
7. **Every set has alt text**, written automatically from the pieces in it ("A set with a black coat from Zara…") and editable by its maker.
8. **Shared pages use real headings and named buttons**, and the sign-in code can be pasted or autofilled; the bot check is invisible.
9. **Automatic checks** (the axe rules for WCAG 2.2 AA) run on nine screens of the app after every deploy, and a change that fails them does not ship.

## 2. What does not meet the standard yet
1. **The Creative canvas with a screen reader.** The pieces on the canvas are listed, in order and by name, in the Layers panel, and each can be selected and moved from there; a hidden list that mirrors the canvas beside it, with every move announced, is being built. Quick sets - the slots-and-template builder - do not have this gap.
2. **Text placed on a picture** has no automatic dark backdrop yet, so its contrast depends on the picture behind it.
3. **Screen readers on the phones:** the apps have not yet been tested by hand with VoiceOver (iOS) and TalkBack (Android). Until they have been, we don't claim it.
4. **Text size on iPhone and iPad:** the iOS app does not yet follow the phone's Dynamic Type setting (the browser's text size on the website, and Android's setting, both work).

## 3. How this was checked
By automatic tests in the build (axe-core with the WCAG 2.2 AA rules, a contrast script over both themes, and a target-size check), on current Chrome. Hand testing with assistive technology is listed above as still to do.

## 4. Tell us
If something on Kleit is hard or impossible for you to use, write to us at kleit.app/contact (choose "Something is broken" and say which screen), or at [accessibility email]. We reply within two business days, and an accessibility problem is treated as a bug, not a wish.

## 5. Browsers and apps
The website works in the current versions of Safari, Chrome, Edge and Firefox; the apps run on iPhone, iPad, and Android phones and tablets.

## 6. Changes
The version and date at the top move whenever a line above changes.
