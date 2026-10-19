import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useTheme } from "./hooks/useTheme";
import { useVault, restoreLastVault, shutdown, documents } from "./vault/store";
import { useUi, confirmDialog } from "./features/ui/store";
import { registerAppCommands } from "./commands/appCommands";
import { handleGlobalKeydown } from "./commands/registry";
import { isTauri } from "./filesystem";
import { Workspace } from "./components/workspace/Workspace";
import { VaultPicker } from "./components/vault/VaultPicker";
import { QuickSwitcher } from "./components/overlays/QuickSwitcher";
import { CommandPalette } from "./components/overlays/CommandPalette";
import { SettingsModal, ShortcutsModal } from "./components/overlays/SettingsModal";
import { Dialogs } from "./components/overlays/Dialogs";
import { ContextMenu } from "./components/overlays/ContextMenu";
import { Toasts } from "./components/overlays/Toasts";
import { HistoryModal } from "./components/overlays/HistoryModal";
import { PagePreview } from "./components/overlays/PagePreview";

registerAppCommands();

export default function App() {
  useTheme();
  const info = useVault((s) => s.info);
  const overlay = useUi((s) => s.overlay);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    void restoreLastVault().finally(() => setBooted(true));
    // Capture phase so app shortcuts (e.g. Mod+G) take precedence over editor defaults.
    window.addEventListener("keydown", handleGlobalKeydown, true);
    // Save as soon as the window loses focus, so switching apps never leaves edits only in memory.
    const onBlur = () => void documents.flushAll();
    window.addEventListener("blur", onBlur);
    const onHidden = () => document.visibilityState === "hidden" && void documents.flushAll();
    document.addEventListener("visibilitychange", onHidden);
    const cleanups: (() => void)[] = [];

    if (isTauri) {
      const win = getCurrentWindow();
      let closing = false;
      void win
        .onCloseRequested(async (e) => {
          if (closing) return;
          await shutdown();
          if (documents.anyDirty()) {
            e.preventDefault();
            const ok = await confirmDialog({
              title: "Some changes could not be saved",
              message: "One or more notes failed to save. Their content is backed up and will be offered again next time. Quit anyway?",
              confirmLabel: "Quit",
              danger: true,
            });
            if (ok) {
              closing = true;
              await win.destroy();
            }
          }
        })
        .then((un) => cleanups.push(un));
      // The custom Quit menu item routes through the same close path.
      void listen("app-quit-requested", () => void win.close()).then((un) => cleanups.push(un));
    } else {
      const onUnload = (e: BeforeUnloadEvent) => {
        if (documents.anyDirty()) e.preventDefault();
      };
      window.addEventListener("beforeunload", onUnload);
      cleanups.push(() => window.removeEventListener("beforeunload", onUnload));
    }
    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown, true);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHidden);
      cleanups.forEach((c) => c());
    };
  }, []);

  useEffect(() => {
    const prevent = (e: MouseEvent) => {
      // Suppress the webview's default context menu except in text fields.
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, .cm-content")) e.preventDefault();
    };
    window.addEventListener("contextmenu", prevent);
    return () => window.removeEventListener("contextmenu", prevent);
  }, []);

  if (!booted) return <div className="boot" aria-busy="true" />;

  return (
    <>
      {info ? <Workspace /> : <VaultPicker />}
      {overlay === "switcher" && info && <QuickSwitcher />}
      {overlay === "palette" && <CommandPalette />}
      {overlay === "settings" && <SettingsModal />}
      {overlay === "shortcuts" && <ShortcutsModal />}
      {info && <HistoryModal />}
      {info && <PagePreview />}
      <Dialogs />
      <ContextMenu />
      <Toasts />
    </>
  );
}
