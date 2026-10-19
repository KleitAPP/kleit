// The legal drafts are bundled as text (wrangler.jsonc `rules`, type "Text"): a `.md` import is its contents.
declare module "*.md" {
  const text: string;
  export default text;
}
