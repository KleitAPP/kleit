/**
 * The public legal pages (spec 19 #4, 14.1 #5, 14.4 #2, 21 #14): /terms, /privacy, /guidelines,
 * /copyright-policy, /cookies and /accessibility, drawn by the Worker from the very files in
 * `docs/legal/` that the app's sheet shows and the lawyer review reads. Before 2026-10-19 every
 * footer pointed Terms and Privacy at /settings/legal, which sits inside the app and bounced a
 * signed-out visitor to /welcome - so a store reviewer, or anyone without an account, had no
 * privacy policy to read. The stores require a public one.
 *
 * The Markdown is read with the same parser the sheet uses (src/legal/markdown.ts), so the two
 * can never show different texts. Everything printed is escaped; the drafts carry no HTML.
 */
import { parseLegal, legalTitle, type Span, type Block } from "../src/legal/markdown";

import accessibility from "../docs/legal/accessibility-statement.md";
import cookies from "../docs/legal/cookie-notice.md";
import guidelines from "../docs/legal/community-guidelines.md";
import copyright from "../docs/legal/copyright-policy.md";
import privacy from "../docs/legal/privacy-policy.md";
import terms from "../docs/legal/terms-of-service.md";

/** Path → the draft it shows. The paths are also in wrangler.jsonc's `run_worker_first`. */
export const LEGAL_PAGES: Record<string, { markdown: string; short: string }> = {
  "/terms": { markdown: terms, short: "Terms" },
  "/privacy": { markdown: privacy, short: "Privacy" },
  "/guidelines": { markdown: guidelines, short: "Community Guidelines" },
  "/copyright-policy": { markdown: copyright, short: "Copyright" },
  "/cookies": { markdown: cookies, short: "Cookies" },
  "/accessibility": { markdown: accessibility, short: "Accessibility" },
};

/** The footer every public page carries: the six documents, Help and Contact. */
export const LEGAL_FOOTER =
  `<a href="/help">Help</a> · <a href="/contact">Contact</a> · ` +
  Object.entries(LEGAL_PAGES)
    .map(([path, page]) => `<a href="${path}">${page.short}</a>`)
    .join(" · ") +
  ` · <a href="/privacy#your-choices-and-rights">Your Privacy Choices</a>`;

function esc(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function spans(list: Span[]): string {
  return list
    .map((s) => {
      if (s.kind === "bold") return `<strong>${esc(s.text)}</strong>`;
      if (s.kind === "link") {
        // Only our own paths and https links leave the parser; the text is still escaped.
        const href = /^(https?:\/\/|\/)/.test(s.href) ? s.href : "/";
        const outside = href.startsWith("http") ? ` rel="noopener"` : "";
        return `<a href="${esc(href)}"${outside}>${esc(s.text)}</a>`;
      }
      return esc(s.text);
    })
    .join("");
}

function block(b: Block): string {
  switch (b.kind) {
    case "heading": {
      // The draft's own `# Title` is the page's <h1>, written by the page; the rest nest under it.
      if (b.level === 1) return "";
      const tag = b.level === 2 ? "h2" : "h3";
      return `<${tag} id="${esc(b.id)}">${esc(b.text)}</${tag}>`;
    }
    case "paragraph":
      return `<p>${spans(b.spans)}</p>`;
    case "item":
      return `<p class="item">${spans(b.spans)}</p>`;
    case "table": {
      const [head, ...rows] = b.rows;
      const th = (head ?? []).map((c) => `<th>${spans(c)}</th>`).join("");
      const tr = rows
        .map((r) => `<tr>${r.map((c) => `<td>${spans(c)}</td>`).join("")}</tr>`)
        .join("");
      return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
    }
  }
}

/** The page's body: the title, the draft, and the shared footer. */
export function legalBody(path: string): { title: string; html: string } | null {
  const page = LEGAL_PAGES[path];
  if (!page) return null;
  const title = legalTitle(page.markdown);
  const html =
    `<h1>${esc(title)}</h1>` +
    parseLegal(page.markdown)
      .map(block)
      .filter((h) => h !== "")
      .join("\n");
  return { title, html };
}

/** The styles these pages add to the Worker's shared STYLE: readable text, a table that fits a phone. */
export const LEGAL_STYLE = `<style>
.legal p{margin:10px 0;font-size:1rem}.legal p.item{margin:6px 0 6px 18px}
.legal h2{font-size:1.25rem;margin:26px 0 6px}.legal h3{font-size:1rem;margin:18px 0 4px}
.legal a{color:#1f1d1a}.legal strong{font-weight:600}
.legal table{border-collapse:collapse;width:100%;margin:12px 0;font-size:0.875rem;display:block;overflow-x:auto}
.legal th,.legal td{border:1px solid #e4ddd1;padding:6px 8px;text-align:left;vertical-align:top;min-width:120px}
.legal th{background:#f3eee6}
</style>`;
