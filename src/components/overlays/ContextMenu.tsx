import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUi } from "../../features/ui/store";
import { formatShortcut } from "../../commands/registry";

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const close = useUi((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
    ref.current.querySelector<HTMLElement>("button:not([disabled])")?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}
    >
      {menu.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${it.danger ? "danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              close();
              it.run?.();
            }}
          >
            <span>{it.label}</span>
            {it.shortcut && <kbd>{formatShortcut(it.shortcut)}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
