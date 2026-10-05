import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton, Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import { createGroup, myMemberships, visibleGroups, type Group } from "@/social/groups";

/** S79 — Groups: the ones you are in (or invited to) and the public ones; New group (M5.3). */
export const Route = createFileRoute("/_app/groups")({
  head: () => ({ meta: [{ title: "Groups" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: Groups,
});

function Groups() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [mine, setMine] = useState<Record<string, "invited" | "joined">>({});
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Group["visibility"]>("public");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([visibleGroups(), myMemberships()]).then(([g, m]) => {
      if (cancelled) return;
      setGroups(g);
      setMine(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function make() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const id = await createGroup(name, visibility, description);
    setBusy(false);
    if (id) void navigate({ to: "/groups/$groupId", params: { groupId: id } });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("groups.title")}</h1>
      <p className="mt-1 text-sm text-ink-soft">{t("groups.notChat")}</p>
      <div className="mt-4">
        <PrimaryButton onClick={() => setMaking(true)}>{t("groups.new")}</PrimaryButton>
      </div>
      {!groups ? (
        <div className="kl-skeleton mt-4 h-24 w-full rounded-md bg-surface-2" />
      ) : groups.length === 0 ? (
        <div className="mt-4">
          <EmptyState line={t("groups.none")} />
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
          {groups.map((g) => (
            <li key={g.id} className="border-b border-line last:border-b-0">
              <Link
                to="/groups/$groupId"
                params={{ groupId: g.id }}
                className="flex min-h-12 items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base text-ink">{g.name}</span>
                  <span className="block truncate text-sm text-ink-soft">
                    {g.description ||
                      (g.visibility === "public" ? t("groups.public") : t("groups.private"))}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-ink-soft">
                  {mine[g.id] === "joined"
                    ? t("groups.mine")
                    : mine[g.id] === "invited"
                      ? t("groups.invited")
                      : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={making}
        onOpenChange={setMaking}
        title={t("groups.new")}
        action={
          <PrimaryButton onClick={() => void make()} disabled={busy || !name.trim()}>
            {t("groups.new")}
          </PrimaryButton>
        }
      >
        <label className="block">
          <span className="text-sm text-ink-soft">{t("groups.name")}</span>
          <input
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-sm text-ink-soft">{t("groups.description")}</span>
          <input
            type="text"
            value={description}
            maxLength={300}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("groups.visibility")}>
          <Chip
            label={t("groups.public")}
            selected={visibility === "public"}
            onToggle={() => setVisibility("public")}
          />
          <Chip
            label={t("groups.private")}
            selected={visibility === "private"}
            onToggle={() => setVisibility("private")}
          />
        </div>
      </Sheet>
    </div>
  );
}
