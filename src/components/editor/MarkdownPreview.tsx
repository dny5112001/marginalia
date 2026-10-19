import { useDeferredValue, useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "../../markdown/render";
import { followLink, useVault, vaultIndex } from "../../vault/store";
import { getBackend } from "../../filesystem";
import { useWorkspace } from "../../features/workspace/store";
import { useSettings } from "../../settings/store";
import { headingSlug } from "../../links/parse";
import { dirname, extname, resolveRelative } from "../../vault/paths";
import { openExternal } from "./MarkdownEditor";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};
const imageCache = new Map<string, string>();

export function MarkdownPreview({ path, content }: { path: string; content: string }) {
  const deferred = useDeferredValue(content);
  const html = useMemo(() => renderMarkdown(deferred), [deferred]);
  const ref = useRef<HTMLDivElement>(null);
  const indexVersion = useVault((s) => s.indexVersion);
  const fontSize = useSettings((s) => s.settings.editorFontSize);

  // Mark unresolved wikilinks and load vault images through the backend.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll<HTMLAnchorElement>("a.wikilink").forEach((a) => {
      const target = a.dataset.target ?? "";
      a.classList.toggle("unresolved", !!target && !vaultIndex.resolveTarget(target, path));
    });
    let cancelled = false;
    el.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => {
      const raw = img.dataset.src!;
      let rel: string | null;
      if (raw.startsWith("wikilink:")) {
        rel = vaultIndex.resolveTarget(decodeURIComponent(raw.slice(9).split("#")[0]), path);
      } else {
        let decoded = raw;
        try {
          decoded = decodeURI(raw);
        } catch {
          /* raw */
        }
        rel = vaultIndex.resolveLink({ target: decoded, kind: "markdown" }, path) ?? resolveRelative(dirname(path), decoded);
      }
      const mime = rel ? MIME[extname(rel)] : undefined;
      if (!rel || !mime) {
        img.alt = `Missing image: ${raw}`;
        img.classList.add("missing");
        return;
      }
      const cached = imageCache.get(rel);
      if (cached) {
        img.src = cached;
        return;
      }
      getBackend()
        .readBase64(rel)
        .then((b64) => {
          const url = `data:${mime};base64,${b64}`;
          if (imageCache.size > 100) imageCache.clear();
          imageCache.set(rel!, url);
          if (!cancelled) img.src = url;
        })
        .catch(() => {
          img.alt = `Could not load ${rel}`;
          img.classList.add("missing");
        });
    });
    return () => {
      cancelled = true;
    };
  }, [html, path, indexVersion]);

  useEffect(() => {
    const onGoto = (e: Event) => {
      const { path: p, heading } = (e as CustomEvent<{ path: string; heading?: string }>).detail;
      if (p !== path || !heading || !ref.current) return;
      const slug = headingSlug(heading);
      const h = [...ref.current.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((x) => headingSlug(x.textContent ?? "") === slug);
      h?.scrollIntoView({ block: "start" });
    };
    window.addEventListener("marginalia:goto-heading", onGoto);
    return () => window.removeEventListener("marginalia:goto-heading", onGoto);
  }, [path]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    const newTab = e.metaKey || e.ctrlKey;
    if (href.startsWith("wikilink:")) {
      const [t, h] = href.slice(9).split("#");
      void followLink(decodeURIComponent(t), path, { newTab, heading: h ? decodeURIComponent(h) : undefined });
    } else if (href.startsWith("tag:")) {
      useWorkspace.getState().setLeftView("search");
      window.dispatchEvent(new CustomEvent("marginalia:search", { detail: `tag:${decodeURIComponent(href.slice(4))}` }));
    } else if (/^(https?:|mailto:)/i.test(href)) {
      openExternal(href);
    } else if (href.startsWith("#")) {
      window.dispatchEvent(new CustomEvent("marginalia:goto-heading", { detail: { path, heading: decodeURIComponent(href.slice(1)) } }));
    } else if (href) {
      let decoded = href;
      try {
        decoded = decodeURI(href);
      } catch {
        /* raw */
      }
      const [t, h] = decoded.split("#");
      const resolved = vaultIndex.resolveLink({ target: t, kind: "markdown" }, path);
      void followLink(resolved ?? t, path, { newTab, heading: h });
    }
  };

  const onChange = (e: React.ChangeEvent | React.MouseEvent) => {
    // Checkboxes in preview are display-only; editing happens in the editor.
    if ((e.target as HTMLInputElement).type === "checkbox") e.preventDefault();
  };

  return (
    <div className="preview-scroll">
      <article
        ref={ref}
        className="markdown-preview"
        style={{ fontSize }}
        onClick={(e) => {
          onChange(e);
          onClick(e);
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
