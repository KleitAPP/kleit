/**
 * Remembering that the 18+ and Terms box was ticked (spec 3.3 #1; design pack §7.1 #7).
 *
 * The box lives on the sign-up sheet, but the account is created two screens later. An
 * independent test walked round it by typing /join/email straight into the address bar, so the
 * agreement has to travel with the person rather than be implied by which screen they came from.
 *
 * It is kept for this tab only: a new tab starts again, which is the safe direction to fail.
 * This is a gate in front of the account, not the legal record — the record is written into the
 * database by `claim_profile` with the terms version and the time.
 */
const KEY = "kleit.agreed";
const SENT_KEY = "kleit.codeSentTo";

/** The version of the Terms the box refers to. Bumped when the Terms change (spec 3.3 #1.4). */
export const TERMS_VERSION = "v0.1";

export function rememberAgreement(): void {
  try {
    window.sessionStorage.setItem(KEY, TERMS_VERSION);
  } catch {
    // Private browsing can refuse storage. The person is still on the sign-up screen with the
    // box ticked, so let them carry on rather than trapping them behind a broken lock.
  }
}

export function hasAgreed(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === TERMS_VERSION;
  } catch {
    return false;
  }
}

export function forgetAgreement(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Remembering that a code really was sent to this address from this tab.
 *
 * Without it, /join/code could be opened by URL for any address: it announced "We sent a 6-digit
 * code to …" when nothing had been sent, and gave anyone an unauthenticated place to guess codes
 * at an address of their choosing. Supabase's own per-device limit is the real defence against
 * guessing; this stops the screen lying and stops it being a convenient place to do it from.
 */
export function rememberCodeSent(email: string): void {
  try {
    window.sessionStorage.setItem(SENT_KEY, email.trim().toLowerCase());
  } catch {
    /* private browsing; the screen still works, it just cannot remember */
  }
}

/**
 * Fails CLOSED. The first version returned true when storage threw, so Safari private browsing,
 * Lockdown Mode and embedded webviews all got past the gate - and the gate was the only thing in
 * front of a mail sender (lesson L25). Two gates that fail in opposite directions is worse than
 * either choice made twice.
 *
 * Storage is only the memory for a reload. The fact that a code was just sent travels with the
 * navigation itself, in memory, which no URL can forge and no storage setting can break.
 */
export function codeWasSentTo(email: string): boolean {
  try {
    const sent = window.sessionStorage.getItem(SENT_KEY);
    return sent !== null && sent === email.trim().toLowerCase();
  } catch {
    return false;
  }
}
