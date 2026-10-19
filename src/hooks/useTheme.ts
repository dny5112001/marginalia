import { useEffect } from "react";
import { useSettings } from "../settings/store";

/** Apply the theme setting to <html data-theme>, following the OS when set to "system". */
export function useTheme() {
  const theme = useSettings((s) => s.settings.theme);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    if (theme !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

export function resolvedTheme(): "dark" | "light" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
