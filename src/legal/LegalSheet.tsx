import { Sheet } from "@/components/kleit";

import communityGuidelines from "../../docs/legal/community-guidelines.md?raw";
import copyrightPolicy from "../../docs/legal/copyright-policy.md?raw";
import privacyPolicy from "../../docs/legal/privacy-policy.md?raw";
import termsOfService from "../../docs/legal/terms-of-service.md?raw";

/**
 * The four documents, opened in a sheet over whatever you were doing (spec 17.1 #6; design pack
 * section 9 #6). On the sign-up screen that matters: the person can read what they are agreeing
 * to without losing the half-finished sign-up behind it.
 *
 * The text is the same file the lawyer review will read - `docs/legal/` - pulled in at build
 * time, so the app can never drift from the drafts in the repository.
 */
export type LegalDoc = "terms" | "privacy" | "guidelines" | "copyright";

const DOCS: Record<LegalDoc, { title: string; body: string }> = {
  terms: { title: "Terms of Service", body: termsOfService },
  privacy: { title: "Privacy Policy", body: privacyPolicy },
  guidelines: { title: "Community Guidelines", body: communityGuidelines },
  copyright: { title: "Copyright Policy", body: copyrightPolicy },
};

/** Just enough Markdown for these four files: headings, bold, list items, paragraphs. */
function render(markdown: string) {
  const lines = markdown.split("\n");
  const out: React.ReactNode[] = [];
  let paragraph: string[] = [];

  const flush = (key: string) => {
    if (paragraph.length === 0) return;
    out.push(
      <p key={key} className="mt-3 text-sm text-ink-soft">
        {emphasise(paragraph.join(" "))}
      </p>,
    );
    paragraph = [];
  };

  lines.forEach((line, i) => {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*(?:\d+\.|[-*])\s+(.*)$/.exec(line);
    if (heading) {
      flush(`p${i}`);
      const level = heading[1]?.length ?? 1;
      out.push(
        <h3 key={i} className={level <= 2 ? "mt-6 font-display text-xl text-ink" : "mt-4 text-base font-medium text-ink"}>
          {heading[2]}
        </h3>,
      );
    } else if (item) {
      flush(`p${i}`);
      out.push(
        <p key={i} className="mt-2 pl-4 text-sm text-ink-soft">
          {emphasise(item[1] ?? "")}
        </p>,
      );
    } else if (line.trim() === "") {
      flush(`p${i}`);
    } else {
      paragraph.push(line.trim());
    }
  });
  flush("last");
  return out;
}

/** **bold** becomes bold; everything else is left exactly as written. */
function emphasise(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-medium text-ink">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

export function LegalSheet({ doc, onClose }: { doc: LegalDoc | null; onClose: () => void }) {
  const chosen = doc ? DOCS[doc] : null;
  return (
    <Sheet
      open={doc !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={chosen?.title ?? ""}
    >
      <div className="max-h-[60dvh] overflow-y-auto pr-1">{chosen ? render(chosen.body) : null}</div>
    </Sheet>
  );
}
