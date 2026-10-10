import { useEffect, useState } from "react";

import { t } from "@/i18n/en";
import { useOnline } from "@/offline/net";
import { onOutboxChange } from "@/offline/outbox";
import { outboxCount } from "@/offline/store";

/**
 * The offline banner (design pack S106; roadmap M8.5). Plain words at the top of every signed-in
 * screen while the phone says there is no network: what still works, and how many edits are
 * waiting to go. It stays for a moment after the network is back while the edits are sent, so
 * "Saved" and "sent" are both true when it goes.
 */
export function OfflineBanner() {
  const online = useOnline();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    void outboxCount().then(setPending);
    return onOutboxChange(setPending);
  }, []);
  if (online && pending === 0) return null;
  return (
    <div role="status" className="border-b border-line bg-surface-2 px-4 py-2 text-sm text-ink">
      {online
        ? t("offline.sending", { count: pending })
        : pending > 0
          ? t("offline.withEdits", { count: pending })
          : t("offline.banner")}
    </div>
  );
}
