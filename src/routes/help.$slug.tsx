import { createFileRoute, notFound } from "@tanstack/react-router";

import { article } from "@/help/articles";

/** One help article. */
export const Route = createFileRoute("/help/$slug")({
  loader: ({ params }) => {
    const a = article(params.slug);
    if (!a) throw notFound();
    return a;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.title} · Help` : "Help" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: HelpArticle,
});

function HelpArticle() {
  const a = Route.useLoaderData();
  return (
    <article>
      <p className="text-sm text-ink-soft">{a.group}</p>
      <h2 className="mt-1 font-display text-xl text-ink">{a.title}</h2>
      {a.body.map((p, i) => (
        <p key={i} className="mt-3 break-words text-base text-ink">
          {p}
        </p>
      ))}
    </article>
  );
}
