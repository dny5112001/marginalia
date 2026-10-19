import { useRef } from "react";

/** Draggable (and keyboard-adjustable) splitter between a sidebar and the center. */
export function Resizer({ side, width, onResize }: { side: "left" | "right"; width: number; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const dir = side === "left" ? 1 : -1;
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} sidebar`}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        document.body.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(start.current.w + (e.clientX - start.current.x) * dir);
      }}
      onPointerUp={() => {
        start.current = null;
        document.body.classList.remove("resizing");
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width - 16 * dir);
        if (e.key === "ArrowRight") onResize(width + 16 * dir);
      }}
    />
  );
}
