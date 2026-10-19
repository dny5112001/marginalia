import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  message: string;
}

export type Dialog =
  | {
      type: "prompt";
      title: string;
      label?: string;
      initial: string;
      confirmLabel: string;
      selectStem?: boolean;
      validate?: (v: string) => string | null;
      resolve: (v: string | null) => void;
    }
  | {
      type: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      resolve: (ok: boolean) => void;
    }
  | {
      type: "pick";
      title: string;
      placeholder: string;
      items: { id: string; label: string; detail?: string }[];
      resolve: (id: string | null) => void;
    };

export type Overlay = null | "palette" | "switcher" | "settings" | "shortcuts";

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  shortcut?: string;
  run?: () => void;
}

interface UiStore {
  toasts: Toast[];
  dialog: Dialog | null;
  overlay: Overlay;
  contextMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  searchFocusTick: number;
  toast(message: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  setOverlay(o: Overlay): void;
  openContextMenu(x: number, y: number, items: ContextMenuItem[]): void;
  closeContextMenu(): void;
  focusSearch(): void;
  closeDialog(): void;
}

let toastSeq = 0;

export const useUi = create<UiStore>((set, get) => ({
  toasts: [],
  dialog: null,
  overlay: null,
  contextMenu: null,
  searchFocusTick: 0,
  toast(message, kind = "info") {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts.slice(-3), { id, kind, message }] });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setOverlay: (overlay) => set({ overlay }),
  openContextMenu: (x, y, items) => set({ contextMenu: { x, y, items } }),
  closeContextMenu: () => set({ contextMenu: null }),
  focusSearch: () => set({ searchFocusTick: get().searchFocusTick + 1 }),
  closeDialog: () => set({ dialog: null }),
}));

export function prompt(opts: Omit<Extract<Dialog, { type: "prompt" }>, "type" | "resolve" | "confirmLabel"> & { confirmLabel?: string }) {
  return new Promise<string | null>((resolve) =>
    useUi.setState({ dialog: { type: "prompt", confirmLabel: "OK", ...opts, resolve } }),
  );
}

export function confirmDialog(opts: Omit<Extract<Dialog, { type: "confirm" }>, "type" | "resolve" | "confirmLabel"> & { confirmLabel?: string }) {
  return new Promise<boolean>((resolve) =>
    useUi.setState({ dialog: { type: "confirm", confirmLabel: "OK", ...opts, resolve } }),
  );
}

export function pick(opts: Omit<Extract<Dialog, { type: "pick" }>, "type" | "resolve">) {
  return new Promise<string | null>((resolve) => useUi.setState({ dialog: { type: "pick", ...opts, resolve } }));
}

export const toast = (m: string, k?: Toast["kind"]) => useUi.getState().toast(m, k);
