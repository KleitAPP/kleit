import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Chip, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";

/**
 * S10 — Style vibes (design pack §2.1; decision 86).
 *
 * Moved OUT of sign-up on purpose: it was the step that pushed sign-up past 30 seconds, and it
 * is far more useful once someone is inside and can see what it changes. It is the fourth start
 * card on Home, and the only one of the four that works today.
 *
 * The names match the fourteen decoration packs, so a vibe picked here means something real
 * later rather than being a label with nothing behind it.
 */
const VIBES = [
  "Y2K", "Coquette", "Cottagecore", "Dark Academia", "Fairycore", "Balletcore", "Art Deco",
  "Victorian Scrap", "Romantic Goth", "Modern Goth", "Hot Pink", "Holo", "Soft Kawaii", "Grunge",
] as const;

export const Route = createFileRoute("/vibes")({
  head: () => ({ meta: [{ title: "Style vibes" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: StyleVibes,
});

function StyleVibes() {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (!me) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("style_vibes")
        .eq("user_id", me)
        .maybeSingle();
      if (!cancelled && profile?.style_vibes) setPicked(profile.style_vibes);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(vibe: string) {
    setPicked((now) => (now.includes(vibe) ? now.filter((v) => v !== vibe) : [...now, vibe]));
  }

  async function save() {
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    const me = data.user?.id;
    if (me) await supabase.from("profiles").update({ style_vibes: picked }).eq("user_id", me);
    setSaving(false);
    void navigate({ to: "/" });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-canvas px-4 pt-10">
      <h1 className="font-display text-2xl text-ink">{t("vibes.title")}</h1>
      <p className="mt-2 text-base text-ink-soft">{t("vibes.hint")}</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {VIBES.map((vibe) => (
          <Chip key={vibe} label={vibe} selected={picked.includes(vibe)} onToggle={() => toggle(vibe)} />
        ))}
      </div>

      <p aria-live="polite" className="mt-4 text-sm text-ink-soft">
        {t("vibes.count", { n: picked.length })}
      </p>

      <div className="mt-6">
        <PrimaryButton disabled={saving || picked.length === 0} onClick={() => void save()}>
          {saving ? t("loading") : t("vibes.save")}
        </PrimaryButton>
      </div>

      <button
        type="button"
        onClick={() => void navigate({ to: "/" })}
        className="mt-3 min-h-12 w-full rounded-pill border border-line bg-surface px-5 text-base font-medium text-ink transition-colors duration-fast hover:bg-surface-2"
      >
        {t("vibes.skip")}
      </button>
    </main>
  );
}
