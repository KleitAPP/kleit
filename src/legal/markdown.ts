/**
 * Just enough Markdown for the legal drafts in `docs/legal/` (spec 17.1 #6; 19 #4): headings,
 * paragraphs, list items, **bold**, [links](https://…) and the one table the privacy policy
 * carries. Pure functions with no DOM, so the app's sheet (src/legal/LegalSheet.tsx) and the
 * Worker's public pages (worker/legal.ts) read the same files the same way - a drift between
 * the two would mean two versions of a legal text, and there is only one.
 *
 * Anything not listed here is left exactly as written, as text. There is no HTML in the
 * drafts and none is ever produced from them: every renderer escapes what it prints.
 */
export type Span =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; text: string; id: string }
  | { kind: "paragraph"; spans: Span[] }
  | { kind: "item"; spans: Span[] }
  | { kind: "table"; rows: Span[][][] };

/** A heading's anchor: "5. Your choices and rights" → "your-choices-and-rights". */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[\d.\s]+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** **bold** and [text](https://…) become spans; everything else is text, exactly as written. */
export function inline(text: string): Span[] {
  const out: Span[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else out.push({ kind: "link", text: m[2] ?? "", href: m[3] ?? "" });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseLegal(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const out: Block[] = [];
  let paragraph: string[] = [];
  let table: string[][] | null = null;

  const flush = () => {
    if (paragraph.length) {
      out.push({ kind: "paragraph", spans: inline(paragraph.join(" ")) });
      paragraph = [];
    }
    if (table) {
      out.push({ kind: "table", rows: table.map((row) => row.map(inline)) });
      table = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const item = /^\s*(?:\d+\.|[-*])\s+(.*)$/.exec(line);
    const row = /^\s*\|(.*)\|\s*$/.exec(line);
    if (row) {
      const cells = (row[1] ?? "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // the |---|---| line under the header
      if (!table) {
        if (paragraph.length) {
          out.push({ kind: "paragraph", spans: inline(paragraph.join(" ")) });
          paragraph = [];
        }
        table = [];
      }
      table.push(cells);
      continue;
    }
    if (table) flush();
    if (heading) {
      flush();
      const text = heading[2] ?? "";
      out.push({ kind: "heading", level: heading[1]?.length ?? 1, text, id: headingId(text) });
    } else if (item) {
      flush();
      out.push({ kind: "item", spans: inline(item[1] ?? "") });
    } else if (line.trim() === "") {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return out;
}

/** The first `# ` heading of a draft, which is its title ("Kleit Privacy Policy"). */
export function legalTitle(markdown: string): string {
  return /^#\s+(.*)$/m.exec(markdown)?.[1]?.trim() ?? "Kleit";
}
