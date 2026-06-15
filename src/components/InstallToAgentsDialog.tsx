import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgents } from "@/hooks/useAgents";
import { useToast } from "@/components/ToastProvider";
import { getAgentIcon } from "@/lib/agentIcons";
import type { Skill } from "@/hooks/useSkills";

export interface InstallToAgentsDialogProps {
  /** Marketplace skill payload (must contain repository) */
  skill: {
    name: string;
    description: string | null;
    repository: string | null;
    source: string;
  };
  onClose: () => void;
}

function AgentBadgeIcon({ slug }: { slug: string }) {
  const icon = getAgentIcon(slug);
  return icon.type === "component"
    ? <icon.Component className="size-4 rounded-[3px]" aria-hidden="true" />
    : <img src={icon.src} alt="" className={`size-4 rounded-[3px] ${icon.monochrome ? "dark:invert" : ""}`} />;
}

export default function InstallToAgentsDialog({ skill, onClose }: InstallToAgentsDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: agents } = useAgents();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);

  const detectedAgents = (agents ?? []).filter((a) => a.detected);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(detectedAgents.map((a) => a.slug)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  async function handleInstall() {
    if (selected.size === 0) return;
    if (!skill.repository) {
      toast(t("aiSearch.installDialogFailed", { message: "no repository" }), "destructive");
      return;
    }
    setInstalling(true);
    try {
      await invoke("install_from_marketplace", {
        skill: {
          name: skill.name,
          description: skill.description,
          author: null,
          repository: skill.repository,
          installs: null,
          source: skill.source,
        },
        targetAgents: Array.from(selected),
      });
      await qc.invalidateQueries({ queryKey: ["skills"] });
      toast(t("aiSearch.installDialogSuccess", { count: selected.size }), "default");
      onClose();
    } catch (e) {
      toast(
        t("aiSearch.installDialogFailed", {
          message: e instanceof Error ? e.message : String(e),
        }),
        "destructive",
      );
    } finally {
      setInstalling(false);
    }
  }

  // Mark which agents already have this skill installed (best-effort, by name)
  const installedSlugs: Set<string> = (() => {
    const s = qc.getQueryData<Skill[]>(["skills"]);
    if (!s) return new Set();
    const matched = s.find((sk) => sk.name === skill.name);
    if (!matched) return new Set();
    return new Set(matched.installations?.map((i) => i.agent_slug) ?? []);
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md animate-fade-in-up"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-2xl glass-dialog p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold truncate">{t("aiSearch.installDialogTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("aiSearch.installDialogDesc", { name: skill.name })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="close"
          >
            <X className="size-4" />
          </button>
        </div>

        {detectedAgents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 p-3 text-xs text-muted-foreground text-center">
            {t("aiSearch.installDialogNoAgents")}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground tabular-nums">
                {selected.size} / {detectedAgents.length}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={selectAll}
                >
                  {t("aiSearch.selectAllAgents")}
                </button>
                <span className="text-muted-foreground/40">·</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:underline"
                  onClick={deselectAll}
                >
                  {t("aiSearch.deselectAllAgents")}
                </button>
              </div>
            </div>
            <ul className="max-h-64 overflow-y-auto space-y-1 -mx-1 px-1">
              {detectedAgents.map((agent) => {
                const isSelected = selected.has(agent.slug);
                const alreadyInstalled = installedSlugs.has(agent.slug);
                return (
                  <li key={agent.slug}>
                    <label
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 cursor-pointer select-none transition-colors ${
                        isSelected
                          ? "border-primary/30 bg-primary/8"
                          : "border-border/40 hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 rounded border-border accent-primary shrink-0"
                        checked={isSelected}
                        onChange={() => toggle(agent.slug)}
                      />
                      <AgentBadgeIcon slug={agent.slug} />
                      <span className="flex-1 text-sm truncate">{agent.name}</span>
                      {alreadyInstalled && (
                        <span className="text-[10px] tabular-nums rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5">
                          ✓
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={installing}>
            {t("aiSearch.installDialogCancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={installing || selected.size === 0 || detectedAgents.length === 0}
            onClick={handleInstall}
            className="gap-1.5"
          >
            {installing ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            {installing
              ? t("aiSearch.installDialogConfirming")
              : t("aiSearch.installDialogConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
