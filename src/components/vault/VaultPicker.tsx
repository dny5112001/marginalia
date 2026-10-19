import { FolderOpen, FolderPlus, X } from "lucide-react";
import { createVaultViaDialog, forgetVault, openKnownVault, openVaultViaDialog, useVault } from "../../vault/store";
import { prompt } from "../../features/ui/store";
import { validateName } from "../../vault/paths";
import { isTauri } from "../../filesystem";
import { Logo } from "../common/Logo";

export function VaultPicker() {
  const known = useVault((s) => s.known);
  const status = useVault((s) => s.status);
  const create = async () => {
    const name = await prompt({ title: "Create new vault", label: "Next, choose the folder it will be created in.", initial: "My Vault", confirmLabel: "Choose location…", validate: validateName });
    if (name) await createVaultViaDialog(name.trim());
  };
  return (
    <div className="vault-picker">
      <div className="drag-strip" data-tauri-drag-region />
      <div className="vault-card">
        <div className="vault-brand">
          <Logo size={40} />
          <div>
            <h1>Marginalia</h1>
            <p className="muted">Your notes, as plain Markdown files on your computer.</p>
          </div>
        </div>
        {status === "opening" ? (
          <p className="muted pad">Opening vault…</p>
        ) : (
          <>
            <div className="vault-actions">
              <button className="vault-action" onClick={() => void openVaultViaDialog()}>
                <FolderOpen size={18} />
                <span>
                  <strong>Open folder as vault</strong>
                  <span className="muted small">Use an existing folder of Markdown notes.</span>
                </span>
              </button>
              <button className="vault-action" onClick={() => void create()}>
                <FolderPlus size={18} />
                <span>
                  <strong>Create new vault</strong>
                  <span className="muted small">Start an empty vault in a new folder.</span>
                </span>
              </button>
            </div>
            {known.length > 0 && (
              <>
                <p className="section-label">Recent vaults</p>
                <ul className="vault-list">
                  {known.map((v) => (
                    <li key={v.path}>
                      <button className="vault-row" onClick={() => void openKnownVault(v.path)} title={v.path}>
                        <strong>{v.name}</strong>
                        <span className="muted small mono">{v.path}</span>
                      </button>
                      <button className="icon-btn" aria-label={`Remove ${v.name} from list`} title="Remove from list (files are not touched)" onClick={() => void forgetVault(v.path)}>
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {!isTauri && <p className="banner info small">Browser sandbox: running without the desktop shell, using an in-memory vault.</p>}
      </div>
    </div>
  );
}
