import { Sheet } from "@/components/kleit";

import accessibilityStatement from "../../docs/legal/accessibility-statement.md?raw";
import communityGuidelines from "../../docs/legal/community-guidelines.md?raw";
import cookieNotice from "../../docs/legal/cookie-notice.md?raw";
import copyrightPolicy from "../../docs/legal/copyright-policy.md?raw";
import privacyPolicy from "../../docs/legal/privacy-policy.md?raw";
import termsOfService from "../../docs/legal/terms-of-service.md?raw";
import { parseLegal, type Span } from "./markdown";

/**
 * The six documents, opened in a sheet over whatever you were doing (spec 17.1 #6; design pack
 * section 9 #6). On the sign-up screen that matters: the person can read what they are agreeing
 * to without losing the half-finished sign-up behind it.
 *
 * The text is the same file the lawyer review will read - `docs/legal/` - pulled in at build
 * time, so the app can never drift from the drafts in the repository; the public pages at
 * kleit.app/terms, /privacy, … (worker/legal.ts) read the same files through the same parser.
 */
export type LegalDoc =
  "terms" | "privacy" | "guidelines" | "copyright" | "cookies" | "accessibility";

const DOCS: Record<LegalDoc, { title: string; body: string }> = {
  terms: { title: "Terms of Service", body: termsOfService },
  privacy: { title: "Privacy Policy", body: privacyPolicy },
  guidelines: { title: "Community Guidelines", body: communityGuidelines },
  copyright: { title: "Copyright Policy", body: copyrightPolicy },
  cookies: { title: "Cookie Notice", body: cookieNotice },
  accessibility: { title: "Accessibility Statement", body: accessibilityStatement },
};

function spans(list: Span[]): React.ReactNode {
  return list.map((s, i) => {
    if (s.kind === "bold")
      return (
        <strong key={i} className="font-medium text-ink">
          {s.text}
        </strong>
      );
    if (s.kind === "link")
      return (
        <a key={i} href={s.href} className="text-ink underline underline-offset-2">
          {s.text}
        </a>
      );
    return s.text;
  });
}

/** Headings, paragraphs, list items, bold, links and the privacy policy's table. */
function render(markdown: string) {
  return parseLegal(markdown).map((b, i) => {
    switch (b.kind) {
      case "heading":
        return (
          <h3
            key={i}
            id={b.id}
            className={
              b.level <= 2
                ? "mt-6 font-display text-xl text-ink"
                : "mt-4 text-base font-medium text-ink"
            }
          >
            {b.text}
          </h3>
        );
      case "item":
        return (
          <p key={i} className="mt-2 pl-4 text-sm text-ink-soft">
            {spans(b.spans)}
          </p>
        );
      case "table": {
        const [head, ...rows] = b.rows;
        return (
          <div key={i} className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm text-ink-soft">
              <thead>
                <tr>
                  {(head ?? []).map((c, j) => (
                    <th
                      key={j}
                      className="border border-line bg-surface-2 px-2 py-1 text-left font-medium text-ink"
                    >
                      {spans(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k} className="border border-line px-2 py-1 align-top">
                        {spans(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      default:
        return (
          <p key={i} className="mt-3 text-sm text-ink-soft">
            {spans(b.spans)}
          </p>
        );
    }
  });
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
      {/* tabIndex makes the scrolling box itself focusable, which is the only way a keyboard or
          screen-reader user can scroll it. Without it, Tab cycled between one button and the
          person could read just the first screen of a document they are asked to agree to. */}
      <div
        tabIndex={0}
        role="document"
        aria-label={chosen?.title ?? ""}
        className="max-h-[60dvh] overflow-y-auto pr-1"
      >
        {chosen ? render(chosen.body) : null}
      </div>
    </Sheet>
  );
}
