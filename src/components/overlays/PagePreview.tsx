import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "../../markdown/render";
import { documents, followLink, vaultIndex } from "../../vault/store";
import { headingSlug } from "../../links/parse";
import { noteTitle } from "../../vault/paths";

interface PreviewState {
  x: number;
  y: number;
  path: string | null;
  target: string;
  heading?: string;
  source: string;
}

const DELAY = 350;

/**
 * Hover previews for internal links: plain hover in reading view, Mod+hover in
 * the editor. One global listener; the popover itself is sanitized HTML.
 */
export function PagePreview() {
  const [state, setState] = useState<PreviewState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".markdown-preview a.wikilink, .cm-lp-wikilink, .cm-wikilink");
      if (!el) return;
      const inEditor = !!el.closest(".cm-editor");
      if (inEditor && !(e.metaKey || e.ctrlKey)) return;
      const source = el.closest<HTMLElement>("[data-note-path]")?.dataset.notePath ?? "";
      let target = el.dataset.target ?? "";
      let heading = el.dataset.heading || undefined;
      if (!target && el.classList.contains("cm-wikilink")) {
        const m = /\[\[([^\]|#]*)(?:#([^\]|]*))?/.exec(el.textContent ?? "");
        target = m?.[1]?.trim() ?? "";
        heading = m?.[2]?.trim() || undefined;
      }
      if (!target) return;
      clearTimeout(hideTimer.current);
      clearTimeout(timer.current);
      const r = el.getBoundingClientRect();
      timer.current = setTimeout(() => {
        setState({ x: r.left, y: r.bottom + 6, path: vaultIndex.resolveTarget(target, source), target, heading, source });
      }, DELAY);
    };
    const onOut = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest(".markdown-preview a.wikilink, .cm-lp-wikilink, .cm-wikilink");
      if (!el) return;
      clearTimeout(timer.current);
      hideTimer.current = setTimeout(() => setState(null), 250);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setState(null);
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    // Scroll to the linked heading inside the popover.
    if (!state?.heading || !popRef.current) return;
    const slug = headingSlug(state.heading);
    const h = [...popRef.current.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((x) => headingSlug(x.textContent ?? "") === slug);
    h?.scrollIntoView({ block: "start" });
  }, [state]);

  if (!state) return null;
  const content = state.path ? (documents.get(state.path)?.content ?? vaultIndex.content(state.path)) : undefined;
  const left = Math.min(state.x, window.innerWidth - 470);
  const top = state.y + 340 > window.innerHeight ? Math.max(8, state.y - 360) : state.y;
  return (
    <div
      ref={popRef}
      className="page-preview"
      style={{ left: Math.max(8, left), top }}
      role="tooltip"
      onMouseEnter={() => clearTimeout(hideTimer.current)}
      onMouseLeave={() => setState(null)}
    >
      {content == null ? (
        <p className="muted">
          “{state.target}” {state.path ? "is not a note." : "doesn't exist yet."}{" "}
          {!state.path && (
            <button className="link-btn" onClick={() => (setState(null), void followLink(state.target, state.source))}>
              Create it
            </button>
          )}
        </p>
      ) : (
        <>
          <div className="page-preview-title">{noteTitle(state.path!)}</div>
          <article className="markdown-preview compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(content.slice(0, 20_000)) }} />
        </>
      )}
    </div>
  );
}
