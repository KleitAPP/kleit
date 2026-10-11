import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";

import { isLiveSite } from "@/lib/site";

/**
 * The debug pages (/dev/components, /dev/screens, /dev/canvas-speed) exist for the owner's
 * reviews and for CI's measurements on the test site. On the live site they are not there at
 * all - the ordinary not-found page answers (security plan #18; WA7). The code stays in the
 * bundle, so the test site keeps its tools; a phone app reaches these paths only through its
 * own screens, and none links here.
 */
export const Route = createFileRoute("/dev")({
  beforeLoad: () => {
    if (isLiveSite()) throw notFound();
  },
  component: () => <Outlet />,
});
