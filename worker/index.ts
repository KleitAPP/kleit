// Kleit share-page Worker (technical pack §4.1 "set-preview", spec 8.2–8.3).
// Only /s/* reaches this code (wrangler.jsonc: run_worker_first). Everything else is a static
// asset or the SPA shell and never runs a Worker, so the free 100k/day limit is untouched.
// M1.2: a placeholder. M3.5 renders the real shared set page with Open Graph tags from Supabase.

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/s/")) {
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Kleit</title></head>
<body><main><h1>This set isn't available</h1><p>Shared sets arrive later in the build.</p></main></body></html>`;
      return new Response(html, {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-robots-tag": "noindex, nofollow",
          "x-kleit-surface": "share-worker",
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
