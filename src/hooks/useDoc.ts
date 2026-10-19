import { useCallback, useSyncExternalStore } from "react";
import { documents } from "../vault/store";
import type { DocState } from "../editor/documents";

/** Subscribe to one open document's state. */
export function useDoc(path: string | undefined): DocState | undefined {
  const subscribe = useCallback(
    (cb: () => void) =>
      documents.subscribe((p) => {
        if (p === path) cb();
      }),
    [path],
  );
  return useSyncExternalStore(subscribe, () => (path ? documents.get(path) : undefined));
}
