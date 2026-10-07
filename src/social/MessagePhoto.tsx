import { useEffect, useState } from "react";

import { t } from "@/i18n/en";
import { supabase } from "@/integrations/supabase/client";

/**
 * A photo inside a message (spec 10.2 #7). Yours shows at once. Someone else's is blurred
 * behind "Tap to view" until tapped - a photo you did not ask for is never on your screen before
 * you choose it. The file can only be read once the scan has cleared it (migration 059's storage
 * policy), so until then the tap says "still being checked" rather than showing anything.
 */
export function MessagePhoto({ path, mine }: { path: string; mine: boolean }) {
  const [revealed, setRevealed] = useState(mine);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "checking">("idle");

  useEffect(() => {
    if (!revealed) return;
    let cancelled = false;
    setState("loading");
    void supabase.storage
      .from("closet-photos")
      .createSignedUrl(path, 60 * 60)
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.signedUrl) {
          setUrl(data.signedUrl);
          setState("idle");
        } else {
          setState("checking");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [revealed, path]);

  if (!revealed) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="mt-1 flex h-40 w-40 items-center justify-center rounded-md border border-line bg-surface-2 text-sm text-ink"
        aria-label={t("dm.tapToView")}
      >
        {t("dm.tapToView")}
      </button>
    );
  }
  if (url) {
    return <img src={url} alt={t("dm.photoAlt")} className="mt-1 max-h-72 max-w-full rounded-md" />;
  }
  return (
    <p className="mt-1 flex h-40 w-40 items-center justify-center rounded-md border border-line bg-surface-2 text-center text-sm text-ink-soft">
      {state === "checking" ? t("dm.photoChecking") : t("loading")}
    </p>
  );
}
