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
