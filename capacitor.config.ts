// Kleit inside the phone apps (roadmap M8.0, decision 109).
// The app builds to plain files in .output/public (TanStack Start SPA mode); Capacitor wraps
// that folder in the Android and iOS shells. `bun run build:native` makes the folder the shells
// expect (index.html = the SPA shell) and copies it in.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Reverse of kleit.app, the domain registered before M8.1b. It is fixed forever once a
  // store build exists, so it is set now rather than after.
  appId: "app.kleit",
  appName: "Kleit",
  webDir: ".output/public",
  android: {
    // Serve the bundle from https://localhost so cookies, crypto.subtle and service workers
    // behave as on the web.
    allowMixedContent: false,
  },
};

export default config;
