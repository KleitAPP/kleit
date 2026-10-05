import { useEffect, useState } from "react";

import { loadDoc, loadImage } from "@/canvas/persist";
import { loadFont } from "@/fonts/load";
import type { Doc } from "@/canvas/doc";
import { libraryUrl, loadCatalogue, type Catalogue } from "@/library/library";

/**
 * A Creative set, read-only, as plain HTML: every visible layer an absolutely placed picture
 * on the set's own background, in percentages of the canvas so it scales with the screen.
 * Used by the set page; the shared page draws the same thing in the Worker.
 */
export function CreativeView({ setId }: { setId: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [families, setFamilies] = useState<Record<string, string>>({});
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDoc(setId).then(async (loaded) => {
      if (cancelled || !loaded) return;
      setDoc(loaded.doc);
      if (
        loaded.doc.backgroundAsset ||
        Object.values(loaded.doc.layers).some((l) => l.kind === "asset")
      )
        void loadCatalogue().then((c) => !cancelled && setCatalogue(c));
      for (const l of Object.values(loaded.doc.layers)) {
        const id = l.kind === "text" ? l.text?.font : undefined;
        if (id)
          void loadFont(id).then(
            (family) => family && !cancelled && setFamilies((f) => ({ ...f, [id]: family })),
          );
      }
      const next: Record<string, string> = {};
      await Promise.all(
        Object.values(loaded.items).map(async (item) => {
          const img = await loadImage(item);
          if (img) next[item.id] = img.src;
        }),
      );
      if (!cancelled) setUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [setId]);

  if (!doc) return <div className="kl-skeleton aspect-[4/5] w-full rounded-md bg-surface-2" />;
  const { w, h } = doc.canvas;
  const background = doc.backgroundAsset ? catalogue?.backgrounds[doc.backgroundAsset] : null;
  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-line"
      style={{
        aspectRatio: `${w} / ${h}`,
        backgroundColor: doc.background,
        containerType: "inline-size",
      }}
    >
      {background ? (
        <img
          src={libraryUrl(background.file)}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {doc.order.map((id) => {
        const l = doc.layers[id];
        if (!l || l.hidden) return null;
        const decor = l.kind === "asset" && l.asset ? catalogue?.assets[l.asset] : null;
        const src = decor ? libraryUrl(decor.file) : urls[l.itemId];
        const crop = l.crop;
        if (l.kind === "text" && l.text) {
          return (
            <div
              key={id}
              className="absolute whitespace-pre-wrap"
              style={{
                left: `${(l.x / w) * 100}%`,
                top: `${(l.y / h) * 100}%`,
                width: `${(l.w / w) * 100}%`,
                transform: `rotate(${l.rotation}deg) scale(${l.flipX ? -1 : 1}, ${l.flipY ? -1 : 1})`,
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
        }
        return (
          <div
            key={id}
            className="absolute overflow-hidden"
            style={{
              left: `${(l.x / w) * 100}%`,
              top: `${(l.y / h) * 100}%`,
              width: `${(l.w / w) * 100}%`,
              height: `${(l.h / h) * 100}%`,
              transform: `rotate(${l.rotation}deg) scale(${l.flipX ? -1 : 1}, ${l.flipY ? -1 : 1})`,
              opacity: l.opacity,
            }}
          >
            {decor?.kind === "structural" ? (
              <span
                role="img"
                aria-label={decor.title}
                className="block size-full"
                style={{
                  backgroundColor: l.colour ?? "#161513",
                  maskImage: `url(${src})`,
                  WebkitMaskImage: `url(${src})`,
                  maskSize: "100% 100%",
                  WebkitMaskSize: "100% 100%",
                }}
              />
            ) : src ? (
              <img
                src={src}
                alt={decor?.title ?? ""}
                className="size-full"
                style={
                  crop
                    ? {
                        objectFit: "fill",
                        width: `${100 / crop.w}%`,
                        height: `${100 / crop.h}%`,
                        marginLeft: `${(-crop.x / crop.w) * 100}%`,
                        marginTop: `${(-crop.y / crop.h) * 100}%`,
                        maxWidth: "none",
                      }
                    : { objectFit: "fill" }
                }
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
