import { useEffect, useMemo, useRef, useState } from "react";
import { useUi, type Dialog } from "../../features/ui/store";
import { FuzzyModal } from "./FuzzyModal";
import { fuzzyFilter } from "../../search/fuzzy";

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.type === "prompt") return <PromptDialog d={dialog} />;
  if (dialog.type === "confirm") return <ConfirmDialog d={dialog} />;
  return <PickDialog d={dialog} />;
}

function done() {
  useUi.getState().closeDialog();
}

function PromptDialog({ d }: { d: Extract<Dialog, { type: "prompt" }> }) {
  const [value, setValue] = useState(d.initial);
  const input = useRef<HTMLInputElement>(null);
  const error = d.validate?.(value) ?? null;
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    const dot = d.initial.lastIndexOf(".");
    if (d.selectStem && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [d]);
  const submit = () => {
    setTouched(true);
    if (error) return;
    done();
    d.resolve(value);
  };
  const cancel = () => {
    done();
    d.resolve(null);
  };
  return (
    <div className="overlay-backdrop" onMouseDown={cancel}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.key === "Escape" && cancel()}
      >
        <h2 id="dlg-title">{d.title}</h2>
        {d.label && <p className="muted small">{d.label}</p>}
        <input ref={input} className="input wide" value={value} onChange={(e) => (setValue(e.target.value), setTouched(true))} aria-invalid={!!error && touched} aria-describedby="dlg-err" spellCheck={false} />
        <p id="dlg-err" className="field-error" role="alert">
          {touched && error ? error : " "}
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!!error && touched}>
            {d.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({ d }: { d: Extract<Dialog, { type: "confirm" }> }) {
  const answer = (ok: boolean) => {
    done();
    d.resolve(ok);
  };
  return (
    <div className="overlay-backdrop" onMouseDown={() => answer(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && answer(false)}>
        <h2 id="dlg-title">{d.title}</h2>
        <p id="dlg-msg">{d.message}</p>
        <div className="dialog-actions">
          <button className="btn" autoFocus onClick={() => answer(false)}>
            Cancel
          </button>
          <button className={`btn ${d.danger ? "danger" : "primary"}`} onClick={() => answer(true)}>
            {d.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PickDialog({ d }: { d: Extract<Dialog, { type: "pick" }> }) {
  const [query, setQuery] = useState("");
  const items = useMemo(
    () => (query ? fuzzyFilter(query, d.items, (i) => i.label, 100).map(({ item, indices }) => ({ ...item, indices })) : d.items),
    [query, d.items],
  );
  return (
    <FuzzyModal
      placeholder={d.placeholder}
      items={items}
      query={query}
      onQuery={setQuery}
      onClose={() => {
        done();
        d.resolve(null);
      }}
      onChoose={(item) => {
        if (!item.id) return;
        done();
        d.resolve(item.id);
      }}
      footer={<span>{d.title}</span>}
    />
  );
}
