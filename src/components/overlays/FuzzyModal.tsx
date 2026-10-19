import { useEffect, useRef, useState } from "react";
import { HighlightedChars } from "../common/Highlighted";

export interface FuzzyItem {
  id: string;
  label: string;
  detail?: string;
  hint?: string;
  indices?: number[];
}

/** Keyboard-first list modal used by the quick switcher, palette and pickers. */
export function FuzzyModal({
  placeholder,
  items,
  query,
  onQuery,
  onChoose,
  onClose,
  footer,
  emptyText = "No matches.",
}: {
  placeholder: string;
  items: FuzzyItem[];
  query: string;
  onQuery: (q: string) => void;
  onChoose: (item: FuzzyItem, e: { newTab: boolean; create: boolean }) => void;
  onClose: () => void;
  footer?: React.ReactNode;
  emptyText?: string;
}) {
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  return (
    <div className="overlay-backdrop" onMouseDown={onClose}>
      <div className="fuzzy-modal" role="dialog" aria-modal="true" aria-label={placeholder} onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="fuzzy-input"
          placeholder={placeholder}
          value={query}
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls="fuzzy-list"
          aria-activedescendant={items[sel] ? `fuzzy-${sel}` : undefined}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const item = items[sel];
              const mod = e.metaKey || e.ctrlKey;
              if (item) onChoose(item, { newTab: mod, create: e.shiftKey });
              else if (e.shiftKey || items.length === 0) onChoose({ id: "", label: query }, { newTab: mod, create: true });
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <ul className="fuzzy-list" id="fuzzy-list" role="listbox" ref={list}>
          {items.map((it, i) => (
            <li
              key={it.id + i}
              id={`fuzzy-${i}`}
              data-idx={i}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? "selected" : ""}
              onMouseMove={() => setSel(i)}
              onClick={(e) => onChoose(it, { newTab: e.metaKey || e.ctrlKey, create: false })}
            >
              <span className="fuzzy-label">
                <HighlightedChars text={it.label} indices={it.indices ?? []} />
              </span>
              {it.detail && <span className="fuzzy-detail">{it.detail}</span>}
              {it.hint && <kbd className="fuzzy-hint">{it.hint}</kbd>}
            </li>
          ))}
          {items.length === 0 && <li className="fuzzy-empty">{emptyText}</li>}
        </ul>
        {footer && <div className="fuzzy-footer">{footer}</div>}
      </div>
    </div>
  );
}
