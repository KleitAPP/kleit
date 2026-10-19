import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { touchDevice } from "@/auth/devices";
import { whereDoIBelong } from "@/auth/session";
import { Sheet, TabBar, type TabId } from "@/components/kleit";
import { createQuickDraft } from "@/sets/sets";
import { createCreativeDraft } from "@/canvas/persist";
import { createTemplate } from "@/templates/templates";
import { t } from "@/i18n/en";
import { LaunchSplash } from "@/screens/LaunchGate";
import { supabase } from "@/integrations/supabase/client";
import { appSettingsQuery } from "@/app/appSettings";
import { rememberNext, takeNext } from "@/auth/next";
import { destinationFor, pollIdFor, setIdFor, watchIncoming } from "@/native/incoming";
import { startPush } from "@/native/push";
import { OfflineBanner } from "@/offline/OfflineBanner";
import { watchOutbox } from "@/offline/outbox";
import { useQuery } from "@tanstack/react-query";

/**
 * The signed-in shell (design pack §3.1): five tabs, always visible, on every signed-in screen.
 *
 * This is a layout route — a real one, deliberately. Home, Search, Inbox and You are its children
 * so the tab bar is mounted once and never re-created when a tab changes; only the middle of the
 * screen swaps. Create is not a route at all: it opens the choice sheet over whatever you were
 * looking at (decision 85), because it is an action, not a place.
 *
 * It also guards the whole shell — nobody reaches a tab without being signed in with a profile.
 */
export const Route = createFileRoute("/_app")({
  component: AppShell,
});

const TAB_PATHS: Record<Exclude<TabId, "create">, string> = {
  home: "/",
  search: "/search",
  inbox: "/inbox",
  you: "/you",
};

function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void whereDoIBelong().then((where) => {
      if (cancelled) return;
      if (where === "signed-out") {
        // A link that may come back after sign-in (only /keep qualifies here; the share pages
        // never reach this shell) is kept the way a share page's Sign up keeps its set.
        rememberNext(`${window.location.pathname}${window.location.search}`);
        void navigate({ to: "/welcome", replace: true });
        return;
      }
      if (where === "deleting") {
        void navigate({ to: "/deleting", replace: true });
        return;
      }
      if (where === "suspended") {
        void navigate({ to: "/suspended", replace: true });
        return;
      }
      if (where === "needs-username") {
        // A brand-new account that arrived with a look to keep (M9.2) gets it after the name.
        rememberNext(`${window.location.pathname}${window.location.search}`);
        void navigate({ to: "/join/username", replace: true });
        return;
      }
      setAllowed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Push (M8.4a): once signed in, and only when the server's switch is on, tell OneSignal who
  // this is so a push can be addressed. Does nothing on the web, and never asks the phone.
  const settings = useQuery(appSettingsQuery);
  const pushOpen = settings.data?.push_open === true;
  useEffect(() => {
    if (allowed !== true || !pushOpen) return;
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      const me = data.user?.id;
      if (!me || cancelled) return;
      void startPush(me, true, (path) => void navigate({ to: path }));
    });
    return () => {
      cancelled = true;
    };
  }, [allowed, pushOpen, navigate]);

  // Offline edits (M8.5): replay on start and whenever the network comes back.
  useEffect(() => {
    if (allowed === true) watchOutbox();
  }, [allowed]);

  // Where you're signed in (spec 3.6 #6): this session says hello, so the list in Settings is true.
  useEffect(() => {
    if (allowed === true) void touchDevice();
  }, [allowed]);

  // Back to the set a shared page sent the person from (spec 8.2 #2), once they are in - or on
  // to the look they built on a brand's site (M9.2), which /keep turns into their draft.
  useEffect(() => {
    if (allowed !== true) return;
    const next = takeNext();
    if (!next) return;
    const target = new URL(next, window.location.origin);
    if (target.pathname === "/keep") {
      void navigate({
        to: "/keep",
        search: { pieces: target.searchParams.get("pieces") ?? "" },
        replace: true,
      });
      return;
    }
    void destinationFor(target.toString(), {
      set: setIdFor,
      poll: pollIdFor,
    }).then((path) => {
      if (path && path !== "/not-available") void navigate({ to: path } as never);
    });
  }, [allowed, navigate]);

  // Shares and links from other apps (M8.2/M8.7, the phone only): a store page shared to Kleit
  // becomes Clip a link; one of our own links becomes the set or poll.
  useEffect(() => {
    if (allowed !== true) return;
    watchIncoming((path) => {
      const [to, query] = path.split("?");
      const search = query ? Object.fromEntries(new URLSearchParams(query)) : undefined;
      void navigate({ to, search } as never);
    });
  }, [allowed, navigate]);

  if (allowed !== true) return <LaunchSplash />;

  const current: TabId =
    pathname.startsWith("/search") || pathname.startsWith("/store/") || pathname.startsWith("/tag/")
      ? "search"
      : pathname.startsWith("/inbox")
        ? "inbox"
        : pathname.startsWith("/you")
          ? "you"
          : "home";

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <OfflineBanner />
      <main className="flex-1">
        <Outlet />
      </main>

      <TabBar
        current={current}
        onSelect={(tab) => {
          if (tab === "create") {
            setCreating(true);
            return;
          }
          void navigate({ to: TAB_PATHS[tab] });
        }}
      />

      <Sheet open={creating} onOpenChange={setCreating} title={t("create.title")}>
        <ul className="flex flex-col">
          <CreateChoice
            title={t("create.quick")}
            why={t("create.quickWhy")}
            onChoose={() => {
              setCreating(false);
              void createQuickDraft().then((id) => {
                if (id) void navigate({ to: "/set/$setId/edit", params: { setId: id } });
              });
            }}
          />
          <CreateChoice
            title={t("create.creative")}
            why={t("create.creativeWhy")}
            onChoose={() => {
              setCreating(false);
              void createCreativeDraft().then((id) => {
                if (id) void navigate({ to: "/set/$setId/canvas", params: { setId: id } });
              });
            }}
          />
          <CreateChoice
            title={t("template.new")}
            why={t("template.newWhy")}
            onChoose={() => {
              setCreating(false);
              void createTemplate(t("template.new")).then((id) => {
                if (id)
                  void navigate({ to: "/template/$templateId/edit", params: { templateId: id } });
              });
            }}
          />
          <CreateChoice
            title={t("create.clip")}
            why={t("create.clipWhy")}
            onChoose={() => {
              setCreating(false);
              void navigate({ to: "/add/link" });
            }}
          />
          <CreateChoice
            title={t("create.photo")}
            why={t("create.photoWhy")}
            onChoose={() => {
              setCreating(false);
              void navigate({ to: "/add/photo" });
            }}
          />
          <CreateChoice
            title={t("create.ask")}
            why={t("create.askWhy")}
            onChoose={() => {
              setCreating(false);
              void navigate({ to: "/asks" });
            }}
          />
          <CreateChoice
            title={t("create.poll")}
            why={t("create.pollWhy")}
            onChoose={() => {
              setCreating(false);
              void navigate({ to: "/poll/new" });
            }}
          />
        </ul>
        <p className="mt-4 text-sm text-ink-soft">{t("create.someNotYet")}</p>
      </Sheet>
    </div>
  );
}

/**
 * One row of the Create sheet. The rest are built in M2 and M3, so until then they are shown as
 * plainly not-yet rather than hidden: a person who opens Create should see what Kleit is for, and
 * a row that silently does nothing is worse than a row that says so. A row that DOES work is a
 * button; the others are not, so the difference is felt and not only read.
 */
function CreateChoice({
  title,
  why,
  onChoose,
}: {
  title: string;
  why: string;
  onChoose?: () => void;
}) {
  if (!onChoose) {
    return (
      <li className="border-b border-line py-3 opacity-60 last:border-b-0" aria-disabled="true">
        <p className="text-base text-ink-soft">{title}</p>
        <p className="text-sm text-ink-soft">{why}</p>
      </li>
    );
  }
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" onClick={onChoose} className="min-h-12 w-full py-3 text-left">
        <span className="block text-base text-ink">{title}</span>
        <span className="block text-sm text-ink-soft">{why}</span>
      </button>
    </li>
  );
}
