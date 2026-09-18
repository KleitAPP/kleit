import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kleit" },
      { name: "description", content: "Kleit" },
      { property: "og:title", content: "Kleit" },
      { property: "og:description", content: "Kleit" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <h1 className="text-6xl font-semibold tracking-tight text-foreground">
        Kleit
      </h1>
    </div>
  );
}
