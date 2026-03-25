import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface AppSettings {
  theme: string | null;
  language: string | null;
  path_overrides: Record<string, string[]> | null;
}

/**
 * Reads the persisted theme setting and applies the `.dark` class
 * to `<html>`. Responds to system preference when theme is "system" / null.
 */
export function useTheme() {
  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: () => invoke("read_settings"),
    staleTime: 5 * 60 * 1000,
  });

  const theme = settings?.theme ?? null; // null = system

  useEffect(() => {
    const root = document.documentElement;

    function apply(dark: boolean) {
      root.classList.toggle("dark", dark);
      // Sync native title bar color with sidebar background
      const bg = dark
        ? { red: 43, green: 43, blue: 43, alpha: 255 }    // oklch(0.205 0 0) ≈ #2b2b2b
        : { red: 250, green: 250, blue: 250, alpha: 255 }; // oklch(0.985 0 0) ≈ #fafafa
      getCurrentWindow().setBackgroundColor(bg).catch(() => {});
    }

    if (theme === "dark") {
      apply(true);
      return;
    }
    if (theme === "light") {
      apply(false);
      return;
    }

    // System: match OS preference and listen for changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    apply(mq.matches);

    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}
