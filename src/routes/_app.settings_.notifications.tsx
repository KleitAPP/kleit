import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { appSettingsQuery } from "@/app/appSettings";
import { Toast } from "@/components/kleit";
import { t } from "@/i18n/en";
import { isNativeApp } from "@/lib/site";
import { usePermissionPrimer } from "@/native/primers";
import {
  IN_APP_KINDS,
  PUSH_KINDS,
  askPhoneForPush,
  pushPermissionGranted,
  readMutedKinds,
  readNotificationPreferences,
  readPushSetting,
  saveInAppMuted,
  saveMarketing,
  saveMutedKinds,
  savePushSetting,
  type InAppKindId,
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
 * Under the switch, the grid (spec 12.1 #6; CL68): each kind of event with an "In the app"
 * switch and, where pushes are on, an "On your phone" one. Everything is on until the person
 * turns it off; likes are in-app only and the phone column says so (12.1 #2). At the bottom,
 * marketing email - a no until they say yes, and nothing sends any yet (the email column is
 * CL43's), which the line says plainly rather than pretending.
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
  const [inAppOff, setInAppOff] = useState<Set<InAppKindId> | null>(null);
  const [marketing, setMarketing] = useState<boolean | null>(null);
  const [kindBusy, setKindBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      readPushSetting(),
      pushPermissionGranted(),
      readMutedKinds(),
      readNotificationPreferences(),
    ]).then(([saved, granted, muted, preferences]) => {
      if (cancelled) return;
      setOn(saved && granted);
      setOff(muted);
      setInAppOff(preferences.inAppOff);
      setMarketing(preferences.marketing);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function flipKind(id: PushKindId) {
    if (off === null) return;
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setKindBusy(`push:${id}`);
    const saved = await saveMutedKinds(next);
    setKindBusy(null);
    if (saved) setOff(next);
    else setNote({ text: t("notify.saveFailed"), tone: "warning" });
  }

  async function flipInApp(id: InAppKindId) {
    if (inAppOff === null) return;
    const next = new Set(inAppOff);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setKindBusy(`app:${id}`);
    const saved = await saveInAppMuted(next);
    setKindBusy(null);
    if (saved) setInAppOff(next);
    else setNote({ text: t("notify.saveFailed"), tone: "warning" });
  }

  async function flipMarketing() {
    if (marketing === null) return;
    const next = !marketing;
    setKindBusy("marketing");
    const saved = await saveMarketing(next);
    setKindBusy(null);
    if (saved) setMarketing(next);
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

      {/* The grid (spec 12.1 #6): a row per kind of event, a switch per place it can reach you. */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-ink-soft">
        {t("notify.gridTitle")}
      </h2>
      <table className="mt-2 w-full border-collapse overflow-hidden rounded-md border border-line bg-surface text-base text-ink">
        <thead>
          <tr className="border-b border-line text-sm text-ink-soft">
            <th scope="col" className="px-4 py-2 text-left font-medium">
              {t("notify.colWhat")}
            </th>
            <th scope="col" className="px-2 py-2 text-center font-medium">
              {t("notify.colInApp")}
            </th>
            <th scope="col" className="px-2 py-2 text-center font-medium">
              {t("notify.colPhone")}
            </th>
          </tr>
        </thead>
        <tbody>
          {IN_APP_KINDS.map(({ id }) => {
            const pushable = PUSH_KINDS.some((k) => k.id === id);
            const pushId = id as PushKindId;
            return (
              <tr key={id} className="border-b border-line last:border-b-0">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  {t(`notify.kind.${id}`)}
                </th>
                <td className="px-2 py-3 text-center">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={t("notify.switchA11y", {
                      what: t(`notify.kind.${id}`),
                      where: t("notify.colInApp"),
                    })}
                    className="size-6 accent-brand"
                    checked={inAppOff !== null && !inAppOff.has(id)}
                    aria-checked={inAppOff !== null && !inAppOff.has(id)}
                    disabled={inAppOff === null || kindBusy !== null}
                    onChange={() => void flipInApp(id)}
                  />
                </td>
                <td className="px-2 py-3 text-center text-sm text-ink-soft">
                  {pushable && native && pushOpen && on ? (
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={t("notify.switchA11y", {
                        what: t(`notify.kind.${id}`),
                        where: t("notify.colPhone"),
                      })}
                      className="size-6 accent-brand"
                      checked={off !== null && !off.has(pushId)}
                      aria-checked={off !== null && !off.has(pushId)}
                      disabled={off === null || kindBusy !== null}
                      onChange={() => void flipKind(pushId)}
                    />
                  ) : (
                    <span aria-label={pushable ? t("notify.phoneOff") : t("notify.neverPhone")}>
                      {pushable ? "–" : t("notify.never")}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-ink-soft">
        {native && pushOpen && on ? t("notify.gridHint") : t("notify.gridHintNoPush")}
      </p>

      <div className="mt-6 rounded-md border border-line bg-surface">
        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-base text-ink">{t("notify.marketing")}</span>
            <span className="text-sm text-ink-soft">{t("notify.marketingWhy")}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="size-6 shrink-0 accent-brand"
            checked={marketing === true}
            aria-checked={marketing === true}
            disabled={marketing === null || kindBusy !== null}
            onChange={() => void flipMarketing()}
          />
        </label>
      </div>

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
