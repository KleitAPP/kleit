import { useEffect, useState } from "react";

import type { Layer, TemplateLayoutV2 } from "@/canvas/doc";
import { loadFont } from "@/fonts/load";
import { libraryUrl, loadCatalogue, type Catalogue } from "@/library/library";

/**
 * What a template brings to a quick set besides its slots (M4.5): its background picture under
 * the pieces, and its decorations and words over them, as plain HTML in canvas percentages -
 * the same drawing as the set page's Creative view. Nothing here takes a tap: the slots under
 * it do.
 */
export function TemplateDressing({
  layout,
  layer,
}: {
  layout: Partial<TemplateLayoutV2> & { canvas: { w: number; h: number } };
  /** "under" draws the background picture; "over" draws decorations and words. */
  layer: "under" | "over";
}) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [families, setFamilies] = useState<Record<string, string>>({});
  const decor = layout.decor ?? {};
  const texts = layout.texts ?? {};
  const needsCatalogue = !!layout.backgroundAsset || Object.keys(decor).length > 0;

  useEffect(() => {
    if (needsCatalogue && !catalogue) void loadCatalogue().then(setCatalogue);
  }, [needsCatalogue, catalogue]);
  useEffect(() => {
    for (const l of Object.values(texts)) {
      const id = l.text?.font;
      if (!id || families[id] !== undefined) continue;
      void loadFont(id).then((f) => f && setFamilies((m) => ({ ...m, [id]: f })));
    }
  }, [texts, families]);

  const { w, h } = layout.canvas;
  if (layer === "under") {
    const bg = layout.backgroundAsset ? catalogue?.backgrounds[layout.backgroundAsset] : null;
    return bg ? (
      <img src={libraryUrl(bg.file)} alt="" className="absolute inset-0 size-full object-cover" />
    ) : null;
  }
  const order = (layout.order ?? []).filter((id) => decor[id] || texts[id]);
  return (
    <div className="pointer-events-none absolute inset-0" style={{ containerType: "inline-size" }}>
      {order.map((id) => {
        const l: Layer | undefined = decor[id] ?? texts[id];
        if (!l || l.hidden) return null;
        const transform = `rotate(${l.rotation}deg) scale(${l.flipX ? -1 : 1}, ${l.flipY ? -1 : 1})`;
        if (l.kind === "text" && l.text)
          return (
            <div
              key={id}
              className="absolute whitespace-pre-wrap"
              style={{
                left: `${(l.x / w) * 100}%`,
                top: `${(l.y / h) * 100}%`,
                width: `${(l.w / w) * 100}%`,
                transform,
                opacity: l.opacity,
                fontFamily: families[l.text.font] ?? "sans-serif",
                fontSize: `${(l.text.size / w) * 100}cqw`,
                lineHeight: 1.2,
                color: l.text.colour,
                textAlign: l.text.align,
              }}
            >
              {l.text.text}
            </div>
          );
        const asset = l.asset ? catalogue?.assets[l.asset] : null;
        if (!asset) return null;
        const box = {
          left: `${(l.x / w) * 100}%`,
          top: `${(l.y / h) * 100}%`,
          width: `${(l.w / w) * 100}%`,
          height: `${(l.h / h) * 100}%`,
          transform,
          opacity: l.opacity,
        };
        if (asset.kind === "structural")
          return (
            <span
              key={id}
              role="img"
              aria-label={asset.title}
              className="absolute block"
              style={{
                ...box,
                backgroundColor: l.colour ?? "#161513",
                maskImage: `url(${libraryUrl(asset.file)})`,
                WebkitMaskImage: `url(${libraryUrl(asset.file)})`,
                maskSize: "100% 100%",
                WebkitMaskSize: "100% 100%",
              }}
            />
          );
        return (
          <img
            key={id}
            src={libraryUrl(asset.file)}
            alt={asset.title}
            className="absolute"
            style={{ ...box, objectFit: "fill" }}
          />
        );
      })}
    </div>
  );
}
