import { useState } from "react";
import { Settings as SettingsIcon, Loader2, Trash2, Check } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { useAllAgents } from "@/hooks/useAgents";

interface AppSettings {
  theme: string | null;
  language: string | null;
  path_overrides: Record<string, string[]> | null;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: agents } = useAllAgents();
  const [cacheCleared, setCacheCleared] = useState(false);

  const { data: settings, isLoading } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: () => invoke("read_settings"),
  });

  const saveMutation = useMutation({
    mutationFn: (s: AppSettings) => invoke("write_settings", { settings: s }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  async function handleClearCache() {
    try {
      await invoke("clear_marketplace_cache");
      await queryClient.invalidateQueries({ queryKey: ["marketplace"] });
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 2000);
    } catch (e) {
      console.error("Clear cache failed:", e instanceof Error ? e.message : String(e));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading settings...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2">
        <SettingsIcon className="size-5" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>

      {/* Theme */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Theme</h2>
        <div className="flex gap-1.5">
          {(["light", "dark", "system"] as const).map((t) => {
            const current = settings?.theme ?? "system";
            const isActive =
              current === t || (t === "system" && !settings?.theme);
            return (
              <Button
                key={t}
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  saveMutation.mutate({
                    ...settings!,
                    theme: t === "system" ? null : t,
                  })
                }
              >
                {t}
              </Button>
            );
          })}
        </div>
      </section>

      {/* Cache */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Marketplace Cache</h2>
        <p className="text-xs text-muted-foreground">
          Marketplace results are cached locally for 5 minutes. Clear the cache
          to force a fresh fetch.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearCache}
          disabled={cacheCleared}
        >
          {cacheCleared ? (
            <>
              <Check className="size-3.5" />
              Cleared
            </>
          ) : (
            <>
              <Trash2 className="size-3.5" />
              Clear Cache
            </>
          )}
        </Button>
      </section>

      {/* Agent paths */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Agent Skill Paths</h2>
        <p className="text-xs text-muted-foreground">
          Default skill directories for each agent.
        </p>
        <div className="space-y-1">
          {agents?.map((agent) => (
            <div
              key={agent.slug}
              className="rounded-md bg-muted/50 px-3 py-2 text-xs space-y-1"
            >
              <span className="font-medium">{agent.name}</span>
              {agent.global_paths.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {agent.global_paths.map((p) => (
                    <button
                      key={p}
                      className="text-muted-foreground hover:text-primary font-mono text-left break-all transition-colors cursor-pointer"
                      title="Reveal in Finder"
                      onClick={() => revealItemInDir(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">{"\u2014"}</span>
              )}
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
