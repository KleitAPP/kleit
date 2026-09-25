import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { setDisplayName } from "@/auth/profile";
import { PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S9 - Name and photo (design pack section 2.1, flow 4.1 step 6).
 *
 * Skip is always visible and is not the quiet option - most people take it, and sign-up is
 * measured in seconds. The profile already exists by now, so skipping loses nothing.
 *
 * The profile photo is deliberately NOT here yet. Every picture a person uploads has to go
 * through the screening pipeline before anyone can see it (spec 16; technical pack `ingest-image`),
 * and that pipeline is built at M2.3. Shipping an upload that skips screening would be the one
 * thing we promised never to do, so the photo waits for the machinery that checks it.
 */
export const Route = createFileRoute("/join/name")({
  head: () => ({ meta: [{ title: "Your name" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: NameAndPhoto,
});

function NameAndPhoto() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function finish(withName: boolean) {
    setSaving(true);
    if (withName && name.trim() !== "") await setDisplayName(name.trim());
    setSaving(false);
    void navigate({ to: "/" });
  }

  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-6 pt-12">
      <div className="mx-auto w-full max-w-sm flex-1">
        <h1 className="font-display text-2xl text-ink">{t("name.title")}</h1>
        <p className="mt-2 text-base text-ink-soft">{t("name.hint")}</p>

        <label htmlFor="displayName" className="mt-8 block text-sm text-ink-soft">
          {t("name.label")}
        </label>
        <input
          id="displayName"
          value={name}
          maxLength={50}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void finish(true);
          }}
          className="mt-2 min-h-12 w-full rounded-sm border border-line bg-surface px-4 text-base text-ink"
        />

        <div className="mt-6">
          <PrimaryButton disabled={saving} onClick={() => void finish(true)}>
            {saving ? t("loading") : t("name.done")}
          </PrimaryButton>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void finish(false)}
          className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
        >
          {t("name.skip")}
        </button>

        <p className="mt-6 text-sm text-ink-soft">{t("name.photoLater")}</p>
      </div>
    </main>
  );
}
