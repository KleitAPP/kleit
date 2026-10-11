import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { appSettingsQuery } from "@/app/appSettings";
import { Toast } from "@/components/kleit";
import { t } from "@/i18n/en";
import { isNativeApp } from "@/lib/site";
import { usePermissionPrimer } from "@/native/primers";
import {
  PUSH_KINDS,
  askPhoneForPush,
  pushPermissionGranted,
  readMutedKinds,
  readPushSetting,
  saveMutedKinds,
  savePushSetting,
  type PushKindId,
} from "@/native/push";

/**
 * Settings > Notifications (spec 10.3; design pack S105 for the primer).
 *
 * One switch. Turning it on shows our primer first, then the phone's own prompt, and only a yes
 * from the phone flips the switch; a no leaves it off and says where to change your mind (the
 * phone's settings, the one place its no can be undone). The quiet hours are not a setting: they
 * are a promise, written on the screen and kept by the server.
 *
 * On the web the switch is not shown: there is no push there (and nothing to pretend with).
 * While the server's push switch is off, the row says so and waits.
 *
 * Under the switch, which kinds reach the phone (spec 12.1 #6): each one is on until the
 * person turns it off; likes are in-app only and the screen says so (12.1 #2).
 */
export const Route = createFileRoute("/_app/settings_/notifications")({
  head: () => ({
    meta: [{ title: "Notifications" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: Notifications,
});

function Notifications() {
  const settings = useQuery(appSettingsQuery);
  const pushOpen = settings.data?.push_open === true;
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "positive" | "warning" } | null>(null);
  const [off, setOff] = useState<Set<PushKindId> | null>(null);
  const [kindBusy, setKindBusy] = useState<PushKindId | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readPushSetting(), pushPermissionGranted(), readMutedKinds()]).then(
      ([saved, granted, muted]) => {
        if (cancelled) return;
        setOn(saved && granted);
        setOff(muted);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function flipKind(id: PushKindId) {
    if (off === null) return;
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setKindBusy(id);
    const saved = await saveMutedKinds(next);
    setKindBusy(null);
    if (saved) setOff(next);
    else setNote({ text: t("notify.saveFailed"), tone: "warning" });
  }

  async function turnOn() {
    setBusy(true);
    const yes = await askPhoneForPush();
    if (!yes) {
      setBusy(false);
      setOn(false);
      setNote({ text: t("notify.phoneSaidNo"), tone: "warning" });
      return;
    }
    const saved = await savePushSetting(true);
    setBusy(false);
    setOn(saved);
    setNote(
      saved
        ? { text: t("notify.on"), tone: "positive" }
        : { text: t("notify.saveFailed"), tone: "warning" },
    );
  }
  const primer = usePermissionPrimer("notifications", () => void turnOn());

  async function turnOff() {
    setBusy(true);
    const saved = await savePushSetting(false);
    setBusy(false);
    if (saved) {
      setOn(false);
      setNote({ text: t("notify.off"), tone: "positive" });
    } else setNote({ text: t("notify.saveFailed"), tone: "warning" });
  }

  const native = isNativeApp();

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("notify.title")}</h1>
      <p className="mt-2 text-base text-ink-soft">{t("notify.why")}</p>

      {primer.sheet}

      {!native ? (
        <p className="mt-6 text-base text-ink">{t("notify.webOnly")}</p>
      ) : !pushOpen ? (
        <p className="mt-6 text-base text-ink">{t("notify.notYet")}</p>
      ) : (
        <div className="mt-6 rounded-md border border-line bg-surface">
          <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-base text-ink">{t("notify.switch")}</span>
              <span className="text-sm text-ink-soft">{t("notify.switchWhy")}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="size-6 shrink-0 accent-brand"
              checked={on === true}
              disabled={on === null || busy}
              aria-checked={on === true}
              onChange={() => (on ? void turnOff() : primer.ask())}
            />
          </label>
        </div>
      )}

      {native && pushOpen && on ? (
        <>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
            {t("notify.kindsTitle")}
          </h2>
          <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
            {PUSH_KINDS.map(({ id }) => (
              <li key={id} className="border-b border-line last:border-b-0">
                <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3">
                  <span className="text-base text-ink">{t(`notify.kind.${id}`)}</span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="size-6 shrink-0 accent-brand"
                    checked={off !== null && !off.has(id)}
                    aria-checked={off !== null && !off.has(id)}
                    disabled={off === null || kindBusy !== null}
                    onChange={() => void flipKind(id)}
                  />
                </label>
              </li>
            ))}
            <li className="px-4 py-3 text-sm text-ink-soft">{t("notify.kind.like")}</li>
          </ul>
        </>
      ) : null}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        {t("notify.rulesTitle")}
      </h2>
      <ul className="mt-2 flex flex-col gap-2 text-base text-ink">
        <li>{t("notify.ruleQuiet")}</li>
        <li>{t("notify.ruleBundle")}</li>
        <li>{t("notify.ruleWhat")}</li>
      </ul>

      {note ? <Toast message={note.text} tone={note.tone} onDismiss={() => setNote(null)} /> : null}
    </div>
  );
}
