import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, CheckSquare, ChevronRight, Hash, List, Plus, Type, X } from "lucide-react";
import { useDoc } from "../../hooks/useDoc";
import { documents } from "../../vault/store";
import { extractFrontmatter } from "../../links/parse";
import { coerceValue, propertyType, removeProperty, renameProperty, setProperty, type PropertyValue } from "../../links/properties";
import { getActiveEditor } from "../../editor/activeEditor";
import { toast } from "../../features/ui/store";

const ICONS = { list: List, checkbox: CheckSquare, number: Hash, date: Calendar, text: Type };

/** Apply new note content, through the editor when it is mounted so the change is undoable. */
function applyContent(path: string, next: string) {
  const active = getActiveEditor();
  if (active && active.path === path) {
    const view = active.view;
    const cur = view.state.doc.toString();
    if (cur === next) return;
    let start = 0;
    while (start < cur.length && start < next.length && cur[start] === next[start]) start++;
    let endCur = cur.length;
    let endNext = next.length;
    while (endCur > start && endNext > start && cur[endCur - 1] === next[endNext - 1]) {
      endCur--;
      endNext--;
    }
    view.dispatch({ changes: { from: start, to: endCur, insert: next.slice(start, endNext) } });
    return;
  }
  documents.replaceContent(path, next);
}

function update(path: string, fn: (content: string) => string) {
  const doc = documents.get(path);
  if (!doc) return;
  try {
    applyContent(path, fn(doc.content));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}

export function PropertiesEditor({ path, readOnly = false }: { path: string; readOnly?: boolean }) {
  const doc = useDoc(path);
  const fm = useMemo(() => (doc ? extractFrontmatter(doc.content) : null), [doc]);
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const onAdd = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== path) return;
      setCollapsed(false);
      setAdding(true);
    };
    window.addEventListener("marginalia:add-property", onAdd);
    return () => window.removeEventListener("marginalia:add-property", onAdd);
  }, [path]);

  if (!doc || doc.status === "loading") return null;
  const entries = Object.entries(fm?.data ?? {});
  if (!fm && !adding) return null;
  if (fm?.error)
    return (
      <div className="properties invalid" role="alert">
        Properties can't be shown: the frontmatter is not valid YAML ({fm.error}). Switch to source mode to fix it.
      </div>
    );

  return (
    <section className="properties" aria-label="Properties">
      <button className="properties-head" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <ChevronRight size={13} className={`chevron ${collapsed ? "" : "open"}`} />
        Properties
      </button>
      {!collapsed && (
        <>
          {entries.map(([key, value]) => (
            <PropertyRow key={key} path={path} name={key} value={value} readOnly={readOnly} />
          ))}
          {!readOnly &&
            (adding ? (
              <NewProperty
                onDone={(name) => {
                  setAdding(false);
                  if (name) update(path, (c) => setProperty(c, name, ""));
                }}
              />
            ) : (
              <button className="prop-add" onClick={() => setAdding(true)}>
                <Plus size={13} /> Add property
              </button>
            ))}
        </>
      )}
    </section>
  );
}

function NewProperty({ onDone }: { onDone: (name: string | null) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="prop-row">
      <input
        className="prop-key-input"
        autoFocus
        placeholder="Property name"
        value={v}
        aria-label="New property name"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onDone(v.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone(v.trim() || null);
          if (e.key === "Escape") onDone(null);
        }}
      />
    </div>
  );
}

function PropertyRow({ path, name, value, readOnly }: { path: string; name: string; value: unknown; readOnly: boolean }) {
  const type = propertyType(value);
  const Icon = ICONS[type];
  const set = (v: PropertyValue) => update(path, (c) => setProperty(c, name, v));
  return (
    <div className="prop-row">
      <span className="prop-key">
        <Icon size={13} aria-hidden />
        {readOnly ? (
          <span>{name}</span>
        ) : (
          <KeyInput name={name} onRename={(to) => update(path, (c) => renameProperty(c, name, to))} />
        )}
      </span>
      <span className="prop-value">
        {type === "list" ? (
          <ListValue values={(value as unknown[]).map(String)} readOnly={readOnly} onChange={(v) => set(v)} tagLike={/^(tags?|aliases?)$/i.test(name)} />
        ) : type === "checkbox" ? (
          <input type="checkbox" checked={value as boolean} disabled={readOnly} aria-label={name} onChange={(e) => set(e.target.checked)} />
        ) : (
          <ScalarInput
            value={value instanceof Date ? value.toISOString().slice(0, 10) : value == null ? "" : String(value)}
            type={type}
            readOnly={readOnly}
            label={name}
            onCommit={(raw) => set(coerceValue(type, raw))}
          />
        )}
      </span>
      {!readOnly && (
        <button className="icon-btn prop-remove" aria-label={`Remove ${name}`} title="Remove property" onClick={() => update(path, (c) => removeProperty(c, name))}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function KeyInput({ name, onRename }: { name: string; onRename: (to: string) => void }) {
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  const commit = () => (v.trim() && v.trim() !== name ? onRename(v.trim()) : setV(name));
  return (
    <input
      className="prop-key-input"
      value={v}
      aria-label={`Property name ${name}`}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ScalarInput({ value, type, readOnly, label, onCommit }: { value: string; type: string; readOnly: boolean; label: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="prop-input"
      type={type === "number" ? "number" : type === "date" ? "date" : "text"}
      value={v}
      readOnly={readOnly}
      placeholder="Empty"
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ListValue({ values, readOnly, onChange, tagLike }: { values: string[]; readOnly: boolean; onChange: (v: string[]) => void; tagLike: boolean }) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const add = () => {
    const items = draft.split(",").map((s) => s.trim().replace(tagLike ? /^#/ : /^$/, "")).filter(Boolean);
    if (items.length) onChange([...values, ...items.filter((i) => !values.includes(i))]);
    setDraft("");
  };
  return (
    <span className="prop-list" onClick={() => input.current?.focus()}>
      {values.map((v) => (
        <span key={v} className={`prop-chip ${tagLike ? "tag" : ""}`}>
          {v}
          {!readOnly && (
            <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          ref={input}
          className="prop-chip-input"
          value={draft}
          placeholder={values.length ? "" : "Empty"}
          aria-label="Add value"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
          }}
        />
      )}
    </span>
  );
}
