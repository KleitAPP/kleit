import { useEffect, useState } from "react";

import { loadDoc, loadImage } from "@/canvas/persist";
import type { Doc } from "@/canvas/doc";

/**
 * A Creative set, read-only, as plain HTML: every visible layer an absolutely placed picture
 * on the set's own background, in percentages of the canvas so it scales with the screen.
 * Used by the set page; the shared page draws the same thing in the Worker.
 */
export function CreativeView({ setId }: { setId: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void loadDoc(setId).then(async (loaded) => {
      if (cancelled || !loaded) return;
      setDoc(loaded.doc);
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
  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-line"
      style={{ aspectRatio: `${w} / ${h}`, backgroundColor: doc.background }}
    >
      {doc.order.map((id) => {
        const l = doc.layers[id];
        if (!l || l.hidden) return null;
        const src = urls[l.itemId];
        const crop = l.crop;
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
            {src ? (
              <img
                src={src}
                alt=""
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
