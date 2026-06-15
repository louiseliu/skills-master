import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe2, Check, ChevronDown } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NetworkConfig {
  proxy_enabled: boolean;
  proxy_url: string | null;
  github_proxy_enabled: boolean;
  github_proxy_prefix: string | null;
}

interface AppSettingsShape {
  theme: string | null;
  language: string | null;
  path_overrides: Record<string, string[]> | null;
  close_action: string | null;
  network: NetworkConfig | null;
}

const DEFAULT_NETWORK: NetworkConfig = {
  proxy_enabled: false,
  proxy_url: null,
  github_proxy_enabled: false,
  github_proxy_prefix: null,
};

export default function NetworkSettingsPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: settings } = useQuery<AppSettingsShape>({
    queryKey: ["settings"],
    queryFn: () => invoke("read_settings"),
  });

  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [ghEnabled, setGhEnabled] = useState(false);
  const [ghPrefix, setGhPrefix] = useState("");
  const [savedRecently, setSavedRecently] = useState(false);
  // Collapsed by default — user can expand to edit
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const net = settings?.network ?? DEFAULT_NETWORK;
    setProxyEnabled(net.proxy_enabled);
    setProxyUrl(net.proxy_url ?? "");
    setGhEnabled(net.github_proxy_enabled);
    setGhPrefix(net.github_proxy_prefix ?? "");
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (network: NetworkConfig) =>
      invoke<void>("write_settings", {
        settings: { ...(settings ?? {}), network },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  async function handleSave() {
    await saveMutation.mutateAsync({
      proxy_enabled: proxyEnabled,
      proxy_url: proxyUrl.trim() || null,
      github_proxy_enabled: ghEnabled,
      github_proxy_prefix: ghPrefix.trim() || null,
    });
    setSavedRecently(true);
    setTimeout(() => setSavedRecently(false), 2000);
  }

  // Active state count for the collapsed-header summary chip
  const activeCount = (proxyEnabled ? 1 : 0) + (ghEnabled ? 1 : 0);

  return (
    <section
      className={cn(
        "rounded-2xl glass-panel glass-shine-always overflow-hidden transition-all",
        open ? "p-5 space-y-4" : "p-3",
      )}
    >
      {/* === Collapsible header === */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between gap-2 group cursor-pointer rounded-lg transition-colors",
          open
            ? "px-0 py-0"
            : "px-2 py-1.5 hover:bg-black/3 dark:hover:bg-white/4",
        )}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <Globe2 className="size-4 text-primary/70 shrink-0" />
          <h2 className="text-sm font-medium truncate">{t("network.title")}</h2>
          {/* State summary chip — only shown when collapsed */}
          {!open && (
            <span
              className={cn(
                "shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                activeCount > 0
                  ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                  : "bg-black/4 dark:bg-white/6 text-muted-foreground",
              )}
            >
              {activeCount > 0 ? (
                <>
                  <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                  {t("network.activeCount", { count: activeCount })}
                </>
              ) : (
                t("network.inactiveLabel")
              )}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground/60 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* === Collapsed: short hint only === */}
      {!open && (
        <p className="text-[11px] text-muted-foreground/60 mt-1 px-2 truncate">
          {t("network.description")}
        </p>
      )}

      {/* === Expanded content === */}
      {open && (
        <>
          <p className="text-xs text-muted-foreground">{t("network.description")}</p>

      {/* HTTP Proxy */}
      <div className="space-y-2 pt-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="size-4 rounded border-border accent-primary"
            checked={proxyEnabled}
            onChange={(e) => setProxyEnabled(e.target.checked)}
          />
          <span className="text-sm font-medium">{t("network.proxy")}</span>
        </label>
        <div className={proxyEnabled ? "space-y-1.5 pl-6" : "space-y-1.5 pl-6 opacity-50"}>
          <label className="text-xs font-medium text-muted-foreground">
            {t("network.proxyUrlLabel")}
          </label>
          <input
            type="text"
            disabled={!proxyEnabled}
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-1.5 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder={t("network.proxyUrlPlaceholder")}
          />
          <p className="text-[11px] text-muted-foreground/70">{t("network.proxyHint")}</p>
        </div>
      </div>

      {/* GitHub Proxy */}
      <div className="space-y-2 border-t border-border/30 pt-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="size-4 rounded border-border accent-primary"
            checked={ghEnabled}
            onChange={(e) => setGhEnabled(e.target.checked)}
          />
          <span className="text-sm font-medium">{t("network.githubProxy")}</span>
        </label>
        <div className={ghEnabled ? "space-y-1.5 pl-6" : "space-y-1.5 pl-6 opacity-50"}>
          <label className="text-xs font-medium text-muted-foreground">
            {t("network.githubProxyPrefix")}
          </label>
          <input
            type="text"
            disabled={!ghEnabled}
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-1.5 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed"
            value={ghPrefix}
            onChange={(e) => setGhPrefix(e.target.value)}
            placeholder={t("network.githubProxyPrefixPlaceholder")}
          />
          <p className="text-[11px] text-muted-foreground/70">{t("network.githubProxyHint")}</p>
        </div>
      </div>

          <div className="pt-1">
            <Button
              variant="default"
              size="sm"
              disabled={saveMutation.isPending}
              onClick={handleSave}
            >
              {savedRecently ? <Check className="size-3" /> : t("network.save")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
