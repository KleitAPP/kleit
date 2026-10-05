import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { EmptyState, Tabs, type TabItem } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  approve,
  decline,
  findPeople,
  myFollowers,
  myFollowing,
  myRequests,
  removeFollower,
  unfollow,
  type Person,
} from "@/social/follows";

/**
 * S75 Followers · S76 Following · S77 Follow requests · S78 Find friends (M5.1), as one screen
 * with three tabs and a search box. Removing a follower and declining a request are quiet:
 * the other person is not told (spec 10.1 #4).
 */
export const Route = createFileRoute("/_app/you_/people")({
  head: () => ({ meta: [{ title: "People" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: People,
});

type Tab = "followers" | "following" | "requests";
const TABS: readonly TabItem<Tab>[] = [
  { id: "followers", label: t("people.followers") },
  { id: "following", label: t("people.following") },
  { id: "requests", label: t("people.requests") },
];

function People() {
  const [tab, setTab] = useState<Tab>("followers");
  const [lists, setLists] = useState<Partial<Record<Tab, Person[]>>>({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = tab === "followers" ? myFollowers : tab === "following" ? myFollowing : myRequests;
    void load().then((p) => !cancelled && setLists((l) => ({ ...l, [tab]: p })));
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setFound(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findPeople(query).then((p) => !cancelled && setFound(p));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function drop(which: Tab, id: string) {
    setLists((l) => ({ ...l, [which]: (l[which] ?? []).filter((p) => p.user_id !== id) }));
  }

  const list = lists[tab];
  const empty =
    tab === "followers"
      ? t("people.noFollowers")
      : tab === "following"
        ? t("people.noFollowing")
        : t("people.noRequests");

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8 pb-8">
      <h1 className="font-display text-2xl text-ink">{t("people.title")}</h1>

      <label className="mt-4 block">
        <span className="text-sm text-ink-soft">{t("people.find")}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("people.findHint")}
          className="mt-1 min-h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink"
        />
      </label>
      {found ? (
        found.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">{t("people.noResults")}</p>
        ) : (
          <ul className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
            {found.map((p) => (
              <Row key={p.user_id} person={p} />
            ))}
          </ul>
        )
      ) : null}

      <div className="mt-6">
        <Tabs items={TABS} current={tab} onChange={setTab} label={t("people.title")}>
          {!list ? (
            <div className="kl-skeleton mt-3 h-24 w-full rounded-md bg-surface-2" />
          ) : list.length === 0 ? (
            <div className="mt-3">
              <EmptyState line={empty} />
            </div>
          ) : (
            <ul className="mt-3 overflow-hidden rounded-md border border-line bg-surface">
              {list.map((p) => (
                <Row key={p.user_id} person={p}>
                  {tab === "followers" ? (
                    <Small
                      label={t("people.remove")}
                      hint={t("people.removeWhy")}
                      onPress={() =>
                        void removeFollower(p.user_id).then(
                          (ok) => ok && drop("followers", p.user_id),
                        )
                      }
                    />
                  ) : tab === "following" ? (
                    <Small
                      label={t("profile.unfollow")}
                      onPress={() =>
                        void unfollow(p.user_id).then((ok) => ok && drop("following", p.user_id))
                      }
                    />
                  ) : (
                    <>
                      <Small
                        label={t("people.approve")}
                        primary
                        onPress={() =>
                          void approve(p.user_id).then((ok) => ok && drop("requests", p.user_id))
                        }
                      />
                      <Small
                        label={t("people.decline")}
                        onPress={() =>
                          void decline(p.user_id).then((ok) => ok && drop("requests", p.user_id))
                        }
                      />
                    </>
                  )}
                </Row>
              ))}
            </ul>
          )}
        </Tabs>
      </div>
    </div>
  );
}

function Row({ person, children }: { person: Person; children?: React.ReactNode }) {
  const name = person.display_name?.trim() ? person.display_name : person.username;
  return (
    <li className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Link to="/u/$username" params={{ username: person.username }} className="min-w-0 flex-1">
        <p className="truncate text-base text-ink">{name}</p>
        <p className="truncate text-sm text-ink-soft">@{person.username}</p>
      </Link>
      <div className="flex shrink-0 gap-2">{children}</div>
    </li>
  );
}

function Small({
  label,
  hint,
  primary = false,
  onPress,
}: {
  label: string;
  hint?: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      title={hint}
      aria-label={hint ? `${label}. ${hint}` : label}
      className={`min-h-11 rounded-pill px-4 text-sm font-medium ${primary ? "bg-brand text-brand-ink" : "border border-line bg-surface text-ink"}`}
    >
      {label}
    </button>
  );
}
