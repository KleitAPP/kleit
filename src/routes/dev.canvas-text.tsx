import { createFileRoute } from "@tanstack/react-router";
import type Konva from "konva";
import { useEffect, useMemo, useRef, useState } from "react";

import { CanvasStage, type Images } from "@/canvas/CanvasStage";
import type { Doc } from "@/canvas/doc";
import { loudPicture, sampleDoc } from "@/canvas/textBackingSample";
import { loadFont } from "@/fonts/load";

/**
 * The text tool's backings (spec 21 #6), side by side on a busy picture, for the eye and for
 * the check script: nothing, a scrim, a solid strip and a blur, in light words and in dark -
 * the same stage the editor uses, with the same document functions (canvas/textBackingSample).
 */
export const Route = createFileRoute("/dev/canvas-text")({
  head: () => ({
    meta: [{ title: "Kleit - text backings" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: CanvasText,
});

function CanvasText() {
  const [doc, setDoc] = useState<Doc>(sampleDoc);
  const [families, setFamilies] = useState<Record<string, string>>({});
  const stageRef = useRef<Konva.Stage | null>(null);
  const images = useMemo<Images>(() => ({ background: loudPicture(1080, 1350) }), []);
  const picture = useMemo(() => ({ ...doc, backgroundAsset: "dev" }), [doc]);
  useEffect(() => {
    void loadFont("playfair").then((family) => {
      if (family) setFamilies({ playfair: family });
    });
  }, []);
  const scale = 360 / doc.canvas.w;
  return (
    <div className="min-h-dvh bg-canvas px-4 py-6 text-ink">
      <h1 className="font-display text-2xl">Text backings (spec 21 #6)</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Nothing, scrim, strip, blur - light words left, dark words right, the last row turned.
      </p>
      <div className="mt-4 inline-block border border-line" data-testid="text-backings">
        <CanvasStage
          doc={picture}
          images={images}
          families={families}
          selected={null}
          cropping={false}
          scale={scale}
          stageRef={stageRef}
          onSelect={() => {}}
          onChange={(id, patch) =>
            setDoc((d) => ({ ...d, layers: { ...d.layers, [id]: { ...d.layers[id]!, ...patch } } }))
          }
          onCrop={() => {}}
          onMeasure={(id, h) =>
            setDoc((d) => ({ ...d, layers: { ...d.layers, [id]: { ...d.layers[id]!, h } } }))
          }
        />
      </div>
    </div>
  );
}
