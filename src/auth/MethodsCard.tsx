import { useEffect, useState } from "react";

import { tidyCode } from "@/auth/codes";
import {
  confirmEmailChange,
  linkGoogle,
  signInMethods,
  startEmailChange,
  unlinkMethod,
  type Method,
} from "@/auth/methods";
import { t } from "@/i18n/en";

/**
 * Settings > Account: "Ways to sign in" and "Change email" (spec 3.6 #1, #2, #4).
 *
 * Email is always listed (it is how codes arrive); Google is Linked or has a Link button; Unlink
 * shows only while there is a second way in, so nobody locks themselves out from this screen.
 * The nudge to link a second way (3.6 #2) is one line, shown while there is only one.
 */
export function MethodsCard({
  email,
  onEmailChanged,
}: {
  email: string | null;
  onEmailChanged: (email: string) => void;
}) {
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [emailNote, setEmailNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void signInMethods().then((list) => {
      if (!cancelled) setMethods(list ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const google = methods?.find((m) => m.provider === "google") ?? null;
  const several = (methods?.length ?? 0) > 1;

  async function link() {
    setBusy(true);
    setNote(null);
    const result = await linkGoogle();
    setBusy(false);
    if (result.ok) return; // Google takes the screen; we come back here linked.
    setNote(
      result.problem === "off"
        ? t("account.linkOff")
        : result.problem === "taken"
          ? t("account.linkTaken")
          : t("account.linkFailed"),
    );
  }

  async function unlink(method: Method) {
    setBusy(true);
    setNote(null);
    const ok = await unlinkMethod(method);
    if (ok) setMethods((methods ?? []).filter((m) => m.id !== method.id));
    else setNote(t("account.linkFailed"));
    setBusy(false);
  }

  async function sendCode() {
    setBusy(true);
    setEmailNote(null);
    const result = await startEmailChange(email, newEmail);
    setBusy(false);
    if (result.ok) {
      setSentTo(newEmail.trim().toLowerCase());
      return;
    }
    setEmailNote(
      result.problem === "bad-address"
        ? t("account.emailBad")
        : result.problem === "same"
          ? t("account.emailSame")
          : result.problem === "taken"
            ? t("account.emailTaken")
            : result.problem === "too-many"
              ? t("code.tooMany")
              : t("account.emailFailed"),
    );
  }

  async function confirm() {
    if (!sentTo || code.length !== 6) return;
    setBusy(true);
    setEmailNote(null);
    const result = await confirmEmailChange(sentTo, code);
    setBusy(false);
    if (result.ok) {
      const changed = result.email ?? sentTo;
      onEmailChanged(changed);
      setChanging(false);
      setSentTo(null);
      setCode("");
      setNewEmail("");
      setEmailNote(t("account.emailChanged", { email: changed }));
      return;
    }
    setEmailNote(
      result.problem === "expired"
        ? t("code.expired")
        : result.problem === "wrong-code"
          ? t("code.wrong")
          : t("account.emailFailed"),
    );
  }

  return (
    <section className="mt-4 rounded-md border border-line bg-surface">
      <h2 className="px-4 pt-3 text-sm font-semibold tracking-wide text-ink-soft">
        {t("account.methods")}
      </h2>
      <ul className="mt-1 divide-y divide-line">
        <li className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-base text-ink">{t("account.methodEmail")}</p>
            <p className="truncate text-sm text-ink-soft">{email ?? ""}</p>
          </div>
          {!changing ? (
            <button
              type="button"
              onClick={() => {
                setChanging(true);
                setEmailNote(null);
              }}
              className="shrink-0 rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium text-ink"
            >
              {t("account.changeEmail")}
            </button>
          ) : null}
        </li>
        {changing ? (
          <li className="px-4 py-3">
            {sentTo === null ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendCode();
                }}
              >
                <label className="block text-sm text-ink-soft">
                  {t("account.newEmail")}
                  <input
                    type="email"
                    value={newEmail}
                    autoComplete="email"
                    inputMode="email"
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
                  />
                </label>
                <p className="text-sm text-ink-soft">{t("account.changeEmailHow")}</p>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy || !newEmail.trim()}
                    className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink disabled:opacity-40"
                  >
                    {busy ? t("loading") : t("account.sendCode")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChanging(false);
                      setEmailNote(null);
                    }}
                    className="min-h-12 rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink"
                  >
                    {t("break.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirm();
                }}
              >
                <p className="text-base text-ink">{t("account.codeSent", { email: sentTo })}</p>
                <p className="text-sm text-ink-soft">{t("account.codeOrLink")}</p>
                <label className="block text-sm text-ink-soft">
                  {t("account.theCode")}
                  <input
                    type="text"
                    value={code}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    onChange={(e) => setCode(tidyCode(e.target.value))}
                    className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base tracking-widest text-ink"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={busy || code.length !== 6}
                    className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink disabled:opacity-40"
                  >
                    {busy ? t("loading") : t("account.confirmEmail")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSentTo(null);
                      setCode("");
                    }}
                    className="min-h-12 rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink"
                  >
                    {t("account.otherAddress")}
                  </button>
                </div>
              </form>
            )}
          </li>
        ) : null}
        {emailNote ? (
          <li className="px-4 py-2">
            <p role="status" className="text-sm text-ink">
              {emailNote}
            </p>
          </li>
        ) : null}
        <li className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-base text-ink">{t("account.methodGoogle")}</p>
            <p className="truncate text-sm text-ink-soft">
              {methods === null
                ? t("loading")
                : google
                  ? (google.email ?? t("account.linked"))
                  : t("account.notLinked")}
            </p>
          </div>
          {methods === null ? null : google ? (
            several ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void unlink(google)}
                className="shrink-0 rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
              >
                {t("account.unlink")}
              </button>
            ) : null
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void link()}
              className="shrink-0 rounded-pill border border-line bg-surface px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
            >
              {t("account.link")}
            </button>
          )}
        </li>
      </ul>
      {methods !== null && !several ? (
        <p className="px-4 pb-3 text-sm text-ink-soft">{t("account.linkWhy")}</p>
      ) : null}
      {note ? (
        <p role="status" className="px-4 pb-3 text-sm text-ink">
          {note}
        </p>
      ) : null}
    </section>
  );
}
