import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { Thumb } from "@/library/LibraryDrawer";
import { loadCatalogue, searchAssets, type Catalogue, type LibraryAsset } from "@/library/library";
import {
  assetFingerprints,
  pullAsset,
  pulledList,
  restoreAsset,
  type Pulled,
} from "@/library/pull";
import { myRoles } from "@/safety/moderation";

/**
 * Pulling a decoration of our own (spec 13.3 #6; migration 118). Admins only. A museum cutout
 * or a drawing that has to come down - a claim, a mistake in the licence record, a picture that
 * turns out to show a person - is named here with a reason: it leaves every drawer within
 * minutes, every set that placed it loses its cached chat picture until its next save, and its
 * fingerprints join the never-again list so a copy cannot come back as a photo. The permanent
 * half is the developer's: the id goes in src/brand/assets/library/pulled.json, the files are
 * deleted, and build-library.mjs refuses to ship while they are still there. Logged.
 */
export const Route = createFileRoute("/_app/mod_/library")({
  head: () => ({
    meta: [{ title: "Pull a decoration" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: PullLibrary,
});

function PullLibrary() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [pulled, setPulled] = useState<Pulled[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<[string, LibraryAsset] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function refresh() {
    setPulled(await pulledList());
  }
  useEffect(() => {
    void myRoles().then(async (r) => {
      const ok = r.includes("admin");
      setAllowed(ok);
      if (ok) {
        await refresh();
        setCatalogue(await loadCatalogue());
      }
    });
  }, []);

  async function pull() {
    if (!picked || busy || reason.trim().length < 3) return;
    setBusy(true);
    const [id, asset] = picked;
    const hashes = await assetFingerprints(asset.file);
    const result = await pullAsset(id, hashes, reason.trim());
    setBusy(false);
    if ("problem" in result) {
      setOutcome(t(`library.pull.err.${result.problem}`));
      return;
    }
    setOutcome(t("library.pull.done", { title: asset.title, count: result.sets }));
    setPicked(null);
    setReason("");
    await refresh();
  }

  async function putBack(id: string) {
    if (busy) return;
    setBusy(true);
    const ok = await restoreAsset(id);
    setBusy(false);
    setOutcome(ok ? t("library.pull.restored") : t("library.pull.err.other"));
    if (ok) await refresh();
  }

  if (allowed === null) return <div className="mx-auto w-full max-w-xl px-4 pt-8" />;
  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-8">
        <EmptyState line={t("mod.notHere")} />
      </div>
    );
  }

  const results =
    catalogue && query.trim().length >= 2 ? searchAssets(catalogue, query, null).slice(0, 30) : [];
  const stillListed = pulled.filter((p) => catalogue && !(p.asset_id in catalogue.assets));

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("library.pull.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("library.pull.why")}</p>
      {outcome ? (
        <p role="status" className="mt-3 text-sm font-medium text-ink">
          {outcome}
        </p>
      ) : null}

      <label className="mt-5 block">
        <span className="text-sm text-ink-soft">{t("library.pull.search")}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("library.pull.placeholder")}
          className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
      </label>
      {catalogue === null ? (
        <p className="mt-2 text-sm text-ink-soft">{t("loading")}</p>
      ) : results.length === 0 && query.trim().length >= 2 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("library.pull.none")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {results.map(([id, asset]) => (
            <li
              key={id}
              className="flex items-center gap-3 rounded-md border border-line bg-surface p-2"
            >
              <span className="block size-16 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                <Thumb asset={asset} alt="" small />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base text-ink">{asset.title}</span>
                <span className="truncate text-sm text-ink-soft">
                  {id} · {asset.credit}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setOutcome(null);
                  setPicked([id, asset]);
                }}
                className="min-h-11 shrink-0 rounded-pill border border-line bg-surface px-4 text-sm text-danger"
              >
                {t("library.pull.pull")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 font-display text-xl text-ink">{t("library.pull.pulledTitle")}</h2>
      {pulled.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{t("library.pull.pulledNone")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {pulled.map((p) => (
            <li key={p.asset_id} className="rounded-md border border-line bg-surface p-3">
              <p className="text-base text-ink">{p.asset_id}</p>
              <p className="mt-1 text-sm text-ink-soft">
                {p.reason} ·{" "}
                {new Date(p.pulled_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
                {stillListed.some((s) => s.asset_id === p.asset_id)
                  ? ` · ${t("library.pull.gone")}`
                  : ""}
              </p>
              <button
                type="button"
                onClick={() => void putBack(p.asset_id)}
                disabled={busy}
                className="mt-2 min-h-11 rounded-pill border border-line bg-surface px-4 text-sm text-ink"
              >
                {t("library.pull.putBack")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={picked !== null}
        onOpenChange={(o) => {
          if (!o) setPicked(null);
        }}
        title={picked ? t("library.pull.confirm", { title: picked[1].title }) : ""}
        description={t("library.pull.confirmWhy")}
        action={
          <PrimaryButton onClick={() => void pull()} disabled={busy || reason.trim().length < 3}>
            {busy ? t("loading") : t("library.pull.pull")}
          </PrimaryButton>
        }
      >
        <label className="block">
          <span className="text-sm text-ink-soft">{t("library.pull.reason")}</span>
          <input
            type="text"
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
      </Sheet>
    </div>
  );
}
