import { create } from "zustand";

interface StatusStore {
  cursor: { line: number; col: number; selected: number } | null;
  setCursor(c: StatusStore["cursor"]): void;
}

export const useStatus = create<StatusStore>((set) => ({
  cursor: null,
  setCursor: (cursor) => set({ cursor }),
}));
