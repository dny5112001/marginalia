import { useVault } from "../vault/store";

/** Re-render when the vault index changes. */
export const useIndexVersion = () => useVault((s) => s.indexVersion);
