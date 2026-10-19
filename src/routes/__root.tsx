import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { t } from "@/i18n/en";

import appCss from "../styles.css?url";
import { CANVAS_DARK, CANVAS_LIGHT } from "@/theme/colours";
import { LaunchGate } from "../screens/LaunchGate";
import { endBreakOnRealSignIn } from "../auth/session";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl text-ink">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-ink-soft">{t("notFound.body")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex min-h-12 items-center justify-center rounded-pill bg-ink px-5 text-base font-medium text-canvas"
          >
            {t("notFound.home")}
          </Link>
        </div>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Kleit" },
      { name: "description", content: "Kleit" },
      { name: "robots", content: "noindex, nofollow" },
      // The browser chrome's colour (spec 19 #11): the canvas colour of each theme, read from the
      // theme file (src/theme/colours.ts), so the bar above the app matches the screen below it.
      // HeadContent keeps one meta per name, so the light twin is written by the shell itself.
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: CANVAS_DARK },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Every icon is generated from the mark by scripts/build-icons.mjs (spec 19 #11): the SVG
      // follows light and dark, the .ico is for browsers that do not read SVG icons.
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon", sizes: "16x16 32x32 48x48" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content={CANVAS_LIGHT} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // A real sign-in ends a break. Mounted here so it is listening whichever door was used.
  useEffect(() => endBreakOnRealSignIn(), []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* S1 launch check: reads the emergency switches, then shows the update screen (S2),
          the maintenance screen (S3), or the app. Nothing renders above it. */}
      <LaunchGate>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </LaunchGate>
    </QueryClientProvider>
  );
}
