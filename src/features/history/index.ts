import { FileHistory, IndexedDbSnapshotStorage, MemorySnapshotStorage } from "./snapshots";
import { getSettings } from "../../settings/store";

/** App-wide file history. Falls back to memory where IndexedDB is unavailable (tests). */
export const fileHistory = new FileHistory(typeof indexedDB === "undefined" ? new MemorySnapshotStorage() : new IndexedDbSnapshotStorage(), {
  enabled: () => getSettings().historyEnabled,
  intervalMs: () => getSettings().historyIntervalMin * 60_000,
  keepDays: () => getSettings().historyKeepDays,
});
