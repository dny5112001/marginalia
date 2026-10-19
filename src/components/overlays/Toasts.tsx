import { X } from "lucide-react";
import { useUi } from "../../features/ui/store";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <span>{t.message}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
