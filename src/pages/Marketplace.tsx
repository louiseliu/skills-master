import { useState, useEffect, useCallback, useDeferredValue, useMemo, memo } from "react";
import { useTranslation } from "react-i18next";
import {
  Store,
  Download,
  Loader2,
  X,
  ExternalLink,
  User,
  Tag,
  Check,
  RefreshCw,
  ArrowLeft,
  Package,
  TrendingUp,
  ChevronDown,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAgents, type AgentConfig } from "@/hooks/useAgents";
import { useSkills, type Skill } from "@/hooks/useSkills";
import { SkillAgentList, installedAgentCount, busyKey, type BusyOp } from "@/components/SkillAgentList";
import MarkdownContent from "@/components/MarkdownContent";
import { useResizable } from "@/hooks/useResizable";
import ResizeHandle from "@/components/ResizeHandle";
import SearchInput from "@/components/SearchInput";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/utils";
import { extractMarkdownBody } from "@/lib/markdown";
import AISkillExplainer from "@/components/AISkillExplainer";
import { getAgentIcon } from "@/lib/agentIcons";

interface MarketplaceSkill {
  name: string;
  description: string | null;
  author: string | null;
  repository: string | null;
  installs: number | null;
  source: string;
}

const SOURCES = [
  { key: "skills.sh", label: "skills.sh" },
  { key: "clawhub", label: "ClawHub" },
  { key: "skillhub", label: "SkillHub" },
];

export default function Marketplace() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [source, setSource] = useState("skills.sh");
  const [skillsshSort, setSkillsshSort] = useState("all-time");
  const [clawhubSort, setClawhubSort] = useState("default");
  const [skillhubSort, setSkillhubSort] = useState("hot");
  const [searchQuery, setSearchQuery] = useState("");
  const [busyAgents, setBusyAgents] = useState<Map<string, BusyOp>>(new Map());
  // selectedKey drives list highlight (instant); detail uses deferred key
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Filter by install status: "all" | "installed" | "not_installed"
  const [installFilter, setInstallFilter] = useState<"all" | "installed" | "not_installed">("all");
  const { data: agents } = useAgents();
  const { data: localSkills } = useSkills();
  const queryClient = useQueryClient();
  const listPane = useResizable({
    initial: 340,
    min: 240,
    max: 560,
    storageKey: "marketplace-list-width",
  });

  // Sort options with translations
  const SKILLSSH_SORTS = useMemo(() => [
    { key: "all-time", label: t("marketplace.sortAllTime") },
    { key: "trending", label: t("marketplace.sortTrending") },
    { key: "hot", label: t("marketplace.sortHot") },
  ], [t]);

  const CLAWHUB_SORTS = useMemo(() => [
    { key: "default", label: t("marketplace.sortDefault") },
    { key: "downloads", label: t("marketplace.sortDownloads") },
    { key: "stars", label: t("marketplace.sortStars") },
  ], [t]);

  const SKILLHUB_SORTS = useMemo(() => [
    { key: "hot", label: t("marketplace.sortHot") },
  ], [t]);

  // SearchInput fires debounced changes; we store the query for React Query
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const currentSort = source === "skills.sh" ? skillsshSort : source === "clawhub" ? clawhubSort : skillhubSort;
  const sorts = source === "skills.sh" ? SKILLSSH_SORTS : source === "clawhub" ? CLAWHUB_SORTS : SKILLHUB_SORTS;
  const setSort = source === "skills.sh" ? setSkillsshSort : source === "clawhub" ? setClawhubSort : setSkillhubSort;
  const deferredSelectedKey = useDeferredValue(selectedKey);

  const {
    data: items,
    isLoading,
    error,
  } = useQuery<MarketplaceSkill[]>({
    queryKey: ["marketplace", source, currentSort, searchQuery],
    queryFn: async () => {
      if (searchQuery.trim()) {
        return invoke("search_marketplace", {
          query: searchQuery.trim(),
          source,
        });
      }
      if (source === "skills.sh") {
        return invoke("fetch_skillssh", { sort: currentSort, page: 1 });
      }
      if (source === "skillhub") {
        return invoke("fetch_skillhub", { section: currentSort });
      }
      return invoke("fetch_clawhub", {
        endpoint: currentSort,
        params: {},
      });
    },
    staleTime: 5 * 60 * 1000, // backend has 5-min SQLite cache; avoid redundant IPC
  });

  // Auto-select first item when data loads
  useEffect(() => {
    if (items?.length && !selectedKey) {
      const first = items[0];
      setSelectedKey(skillKey(first));
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedSkill = useMemo(() => {
    if (!items?.length || !deferredSelectedKey) return null;
    return items.find((item) => skillKey(item) === deferredSelectedKey) ?? null;
  }, [items, deferredSelectedKey]);

  async function handleInstall(
    skill: MarketplaceSkill,
    targetAgents: string[]
  ) {
    if (!targetAgents.length) return;
    const localSkill = findLocalSkill(localSkills, skill.name, skill.repository);
    const op: BusyOp = localSkill ? "syncing" : "installing";
    // Use localSkill.id when available, fall back to skill.name for first-time installs
    const sid = localSkill?.id ?? skill.name;
    setBusyAgents((prev) => {
      const next = new Map(prev);
      targetAgents.forEach((a) => next.set(busyKey(sid, a), op));
      return next;
    });
    try {
      if (localSkill) {
        // Fast path: copy from local installation (no git clone needed)
        await invoke("sync_skill", {
          skillId: localSkill.id,
          targetAgents,
        });
      } else {
        // Slow path: first install, clone from repository
        await invoke("install_from_marketplace", {
          skill,
          targetAgents,
        });
      }
      // Refresh local skills so "Installed" state updates
      const updated = await queryClient.fetchQuery<Skill[]>({
        queryKey: ["skills"],
        queryFn: () => invoke("scan_all_skills"),
        staleTime: 0,
      });
      queryClient.setQueryData(["skills"], updated);
    } catch (e) {
      console.error("Install failed:", e instanceof Error ? e.message : String(e));
      toast(t("marketplace.installFailed"), "destructive");
    } finally {
      setBusyAgents((prev) => {
        const next = new Map(prev);
        targetAgents.forEach((a) => next.delete(busyKey(sid, a)));
        return next;
      });
    }
  }

  async function handleUninstall(skillId: string, agentSlug: string) {
    const k = busyKey(skillId, agentSlug);
    setBusyAgents((prev) => new Map(prev).set(k, "uninstalling"));
    try {
      await invoke("uninstall_skill", { skillId, agentSlug });
      const updated = await queryClient.fetchQuery<Skill[]>({
        queryKey: ["skills"],
        queryFn: () => invoke("scan_all_skills"),
        staleTime: 0,
      });
      queryClient.setQueryData(["skills"], updated);
    } catch (e) {
      console.error("Uninstall failed:", e instanceof Error ? e.message : String(e));
      toast(t("marketplace.uninstallFailed"), "destructive");
    } finally {
      setBusyAgents((prev) => {
        const next = new Map(prev);
        next.delete(k);
        return next;
      });
    }
  }

  // Filtered items by install status
  const filteredItems = useMemo(() => {
    if (!items) return items;
    if (installFilter === "all") return items;
    return items.filter((it) => {
      const local = findLocalSkill(localSkills, it.name, it.repository);
      const isInstalled = !!local && installedAgentCount(local, detectedAgents) > 0;
      return installFilter === "installed" ? isInstalled : !isInstalled;
    });
  }, [items, installFilter, localSkills, detectedAgents]);

  // Counts for filter pills
  const counts = useMemo(() => {
    if (!items) return { all: 0, installed: 0, notInstalled: 0 };
    let installed = 0;
    for (const it of items) {
      const local = findLocalSkill(localSkills, it.name, it.repository);
      if (local && installedAgentCount(local, detectedAgents) > 0) installed++;
    }
    return {
      all: items.length,
      installed,
      notInstalled: items.length - installed,
    };
  }, [items, localSkills, detectedAgents]);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["marketplace", source, currentSort, searchQuery],
    });
  }, [queryClient, source, currentSort, searchQuery]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* === Page Header (full-width, gradient accent) === */}
      <div className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-center gap-2.5">
          <div className="size-9 shrink-0 rounded-xl bg-linear-to-br from-primary/15 via-primary/8 to-transparent ring-1 ring-primary/15 flex items-center justify-center">
            <Store className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold leading-none truncate">
              {t("marketplace.title")}
            </h1>
            <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
              {searchQuery || installFilter !== "all"
                ? t("marketplace.headerSubtitleFiltered", {
                    filtered: filteredItems?.length ?? 0,
                    total: items?.length ?? 0,
                  })
                : t("marketplace.headerSubtitle", {
                    total: items?.length ?? 0,
                    sourceCount: SOURCES.length,
                  })}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("marketplace.refresh")}
          disabled={isLoading}
          onClick={handleRefresh}
        >
          <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
        </Button>
      </div>

      {/* === Main row: list (left) + detail (right) === */}
      <div className="flex-1 flex min-h-0">
      {/* Main list */}
      <div
        className="shrink-0 overflow-y-auto p-4 space-y-3"
        style={{ width: listPane.width }}
      >
        {/* Source tabs — segmented style */}
        <div className="flex items-center gap-1 rounded-xl bg-black/4 dark:bg-white/4 p-1">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setSource(s.key);
                setSearchQuery("");
                setSelectedKey(null);
                setInstallFilter("all");
              }}
              className={cn(
                "flex-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
                source === s.key
                  ? "bg-background shadow-sm text-foreground ring-1 ring-black/5 dark:ring-white/10"
                  : "text-muted-foreground hover:text-foreground/80",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Sort selector + Filter pills */}
        {!searchQuery && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-0.5">
              {sorts.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSort(s.key)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                    currentSort === s.key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-black/4 dark:hover:bg-white/4 hover:text-foreground/80",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Install status filter pills */}
        {items && items.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <FilterChip
              active={installFilter === "all"}
              onClick={() => setInstallFilter("all")}
              icon={<Package className="size-3" />}
              label={t("marketplace.filterAll")}
              count={counts.all}
            />
            <FilterChip
              active={installFilter === "installed"}
              onClick={() => setInstallFilter("installed")}
              icon={<Check className="size-3" />}
              label={t("marketplace.filterInstalled")}
              count={counts.installed}
              tone="success"
            />
            <FilterChip
              active={installFilter === "not_installed"}
              onClick={() => setInstallFilter("not_installed")}
              icon={<Download className="size-3" />}
              label={t("marketplace.filterNotInstalled")}
              count={counts.notInstalled}
            />
          </div>
        )}

        {/* Search */}
        <SearchInput
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder={t("marketplace.searchPlaceholder", { source: source === "skills.sh" ? "skills.sh" : source === "clawhub" ? "ClawHub" : "SkillHub" })}
          debounce={350}
        />

        {/* Results */}
        {isLoading ? (
          <div className="space-y-1.5 py-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-lg px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-28 rounded animate-skeleton" />
                  <div className="h-3 w-8 rounded animate-skeleton" />
                </div>
                <div className="h-3 w-44 rounded animate-skeleton" />
                <div className="flex gap-2">
                  <div className="h-3 w-16 rounded animate-skeleton" />
                  <div className="h-4 w-12 rounded-full animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {t("marketplace.failedToLoad", { error: String(error) })}
          </div>
        ) : !filteredItems?.length ? (
          <div className="rounded-2xl border border-dashed border-black/6 dark:border-white/6 p-8 text-center animate-fade-in">
            <div className="inline-flex size-12 items-center justify-center rounded-xl glass mb-3">
              <Store className="size-6 text-primary/40" />
            </div>
            <p className="text-sm font-medium text-foreground/80">
              {t("marketplace.noSkillsFound")}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {t("marketplace.noSkillsHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredItems.map((skill) => {
              const local = findLocalSkill(localSkills, skill.name, skill.repository);
              const installCount = local ? installedAgentCount(local, detectedAgents) : 0;
              return (
                <MarketplaceListItem
                  key={skillKey(skill)}
                  skill={skill}
                  selected={selectedKey === skillKey(skill)}
                  installCount={installCount}
                  agentCount={detectedAgents.length}
                  onSelect={setSelectedKey}
                />
              );
            })}
          </div>
        )}
      </div>

      <ResizeHandle onMouseDown={listPane.onMouseDown} />

      {/* Detail panel */}
      {selectedKey ? (
        !selectedSkill ? (
          <div className="flex-1 min-w-0 m-2 ml-0 rounded-2xl glass-panel flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <MarketplaceSkillDetail
            skill={selectedSkill}
            busyAgents={busyAgents}
            detectedAgents={detectedAgents}
            localSkills={localSkills}
            onInstall={(targets) => handleInstall(selectedSkill, targets)}
            onUninstall={handleUninstall}
            onClose={() => { setSelectedKey(null); }}
          />
        )
      ) : (
        <div className="flex-1 min-w-0 m-2 ml-0 rounded-2xl glass-panel flex flex-col items-center justify-center text-center px-6 animate-fade-in">
          <div className="size-16 rounded-2xl bg-linear-to-br from-primary/10 via-primary/5 to-transparent ring-1 ring-primary/15 flex items-center justify-center mb-3">
            <Store className="size-7 text-primary/60" />
          </div>
          <p className="text-sm font-medium text-foreground/80">
            {t("marketplace.title")}
          </p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-[280px]">
            {t("marketplace.noSkillsHint")}
          </p>
        </div>
      )}
      </div>{/* end main row */}
    </div>
  );
}

// ============================================================
//  FilterChip — small pill button used for install-status filter
// ============================================================
function FilterChip({
  active,
  onClick,
  icon,
  label,
  count,
  tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  tone?: "default" | "success";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full pl-2 pr-1.5 py-1 text-[11px] font-medium transition-all border",
        active
          ? tone === "success"
            ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
            : "bg-primary/12 text-primary border-primary/25"
          : "bg-transparent text-muted-foreground border-transparent hover:bg-black/4 dark:hover:bg-white/4",
      )}
    >
      {icon}
      <span>{label}</span>
      <span
        className={cn(
          "ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[16px] rounded-full px-1 text-[10px] tabular-nums",
          active
            ? tone === "success"
              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
              : "bg-primary/15 text-primary"
            : "bg-black/6 dark:bg-white/8 text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

const MarketplaceListItem = memo(function MarketplaceListItem({
  skill,
  selected,
  installCount,
  agentCount,
  onSelect,
}: {
  skill: MarketplaceSkill;
  selected: boolean;
  installCount: number;
  agentCount: number;
  onSelect: (key: string) => void;
}) {
  const key = skillKey(skill);
  const isInstalled = installCount > 0;
  const allInstalled = isInstalled && installCount === agentCount;
  return (
    <button
      type="button"
      className={cn(
        "group w-full rounded-xl px-3 py-2.5 text-left transition-all duration-200 relative",
        selected
          ? "glass glass-shine-always ring-1 ring-primary/25"
          : isInstalled
            ? "border border-emerald-500/15 bg-emerald-500/4 hover:border-emerald-500/25 hover:bg-emerald-500/8"
            : "border border-transparent hover:bg-black/3 dark:hover:bg-white/4",
      )}
      onClick={() => onSelect(key)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-medium truncate">{skill.name}</h3>
            {isInstalled && (
              <span
                className={cn(
                  "shrink-0 inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-bold leading-none tabular-nums",
                  allInstalled
                    ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                )}
                title={allInstalled ? "已全部安装" : `已装 ${installCount}/${agentCount}`}
              >
                <Check className="size-2.5" />
                {allInstalled ? "✓" : `${installCount}/${agentCount}`}
              </span>
            )}
          </div>
          {skill.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 leading-relaxed">
              {skill.description}
            </p>
          )}
        </div>
        {skill.installs != null && (
          <span
            className="shrink-0 inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground tabular-nums"
            title={`${skill.installs.toLocaleString()} ${skill.installs === 1 ? "install" : "installs"}`}
          >
            <TrendingUp className="size-2.5" />
            {formatInstalls(skill.installs)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 min-w-0">
        {skill.author && (
          <span className="inline-flex items-center gap-0.5 text-[10.5px] text-muted-foreground truncate min-w-0">
            <User className="size-2.5 shrink-0" />
            <span className="truncate">{skill.author}</span>
          </span>
        )}
        <span
          className={cn(
            "shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider",
            sourceTone(skill.source),
          )}
        >
          {skill.source}
        </span>
      </div>
    </button>
  );
});

/** Source-specific colors so each marketplace has a distinct visual identity */
function sourceTone(source: string): string {
  switch (source) {
    case "skills.sh":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
    case "clawhub":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-300";
    case "skillhub":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-300";
    default:
      return "bg-secondary text-secondary-foreground";
  }
}

function MarketplaceSkillDetail({
  skill,
  busyAgents,
  detectedAgents,
  localSkills,
  onInstall,
  onUninstall,
  onClose,
}: {
  skill: MarketplaceSkill;
  busyAgents: Map<string, BusyOp>;
  detectedAgents: AgentConfig[];
  localSkills: Skill[] | undefined;
  onInstall: (targetAgents: string[]) => void;
  onUninstall: (skillId: string, agentSlug: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const anyBusy = busyAgents.size > 0;
  const isInstalling = [...busyAgents.values()].some((op) => op === "installing" || op === "syncing");
  const [installDialogOpen, setInstallDialogOpen] = useState(false);

  // Auto-close install dialog once install begins
  useEffect(() => {
    if (isInstalling) setInstallDialogOpen(false);
  }, [isInstalling]);
  // Find the matching local skill (if any agent has it installed)
  const localSkill = useMemo(
    () => findLocalSkill(localSkills, skill.name, skill.repository),
    [localSkills, skill.name, skill.repository],
  );

  // Compute install status once per relevant update
  const { installedCount, hasAnyInstalled, allInstalled, notInstalledAgents } = useMemo(() => {
    const count = installedAgentCount(localSkill, detectedAgents);
    const allAgentSet = new Set(
      localSkill ? localSkill.installations.map((i) => i.agent_slug) : [],
    );
    const notInstalled = detectedAgents.filter((a) => !allAgentSet.has(a.slug));
    return {
      installedCount: count,
      hasAnyInstalled: !!localSkill,
      allInstalled: detectedAgents.length > 0 && notInstalled.length === 0,
      notInstalledAgents: notInstalled,
    };
  }, [localSkill, detectedAgents]);

  // Defer the heavy markdown rendering so detail panel paints instantly
  const currentSkillKey = skillKey(skill);
  const deferredSkillKey = useDeferredValue(currentSkillKey);
  const isStale = deferredSkillKey !== currentSkillKey;

  // Fetch SKILL.md via React Query — cached across skill selections
  const { data: remoteContent, isLoading: contentLoading } = useQuery<
    string | null
  >({
    queryKey: ["skill-content", skill.repository, skill.name],
    queryFn: async () => {
      const text = await invoke<string>("fetch_remote_skill_content", {
        repoUrl: skill.repository,
        skillName: skill.name,
      });
      return extractMarkdownBody(text);
    },
    enabled: !!skill.repository && !isStale,
    staleTime: 30 * 60 * 1000, // SKILL.md content rarely changes; cache 30 min
    retry: false,
  });

  return (
    <div className="flex-1 min-w-0 m-2 ml-0 rounded-2xl glass-panel flex flex-col overflow-hidden">
      {/* === Sticky Breadcrumb Header === */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-black/4 dark:border-white/4">
        <button
          type="button"
          onClick={onClose}
          className="min-w-0 inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors group"
          title={t("marketplace.backToList")}
        >
          <ArrowLeft className="size-3.5 shrink-0 group-hover:-translate-x-0.5 transition-transform" />
          <span className="font-medium hover:underline shrink-0">
            {t("marketplace.title")}
          </span>
          <span className="text-muted-foreground/40 shrink-0">/</span>
          <span
            className={cn(
              "shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider",
              sourceTone(skill.source),
            )}
          >
            {skill.source}
          </span>
          <span className="text-muted-foreground/40 shrink-0">/</span>
          <span className="text-foreground font-medium truncate" title={skill.name}>
            {skill.name}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          title={t("marketplace.backToList")}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* === Scrollable body === */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* === Hero card === */}
        <div className="relative rounded-2xl border border-black/5 dark:border-white/8 bg-linear-to-br from-primary/4 via-transparent to-transparent p-4 overflow-hidden">
          {/* Decorative orb */}
          <div
            className="pointer-events-none absolute -top-12 -right-12 size-32 rounded-full bg-linear-to-br from-primary/8 to-transparent blur-2xl"
            aria-hidden="true"
          />

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold leading-tight wrap-break-word">
                {skill.name}
              </h2>
              {/* Meta chips row */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {skill.author && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                    <User className="size-3" />
                    {skill.author}
                  </span>
                )}
                {skill.installs != null && (
                  <span className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground tabular-nums">
                    <TrendingUp className="size-3" />
                    {formatInstalls(skill.installs)} {t("marketplace.installsCount")}
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider",
                    sourceTone(skill.source),
                  )}
                >
                  {skill.source}
                </span>
              </div>
            </div>

            {hasAnyInstalled && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 text-xs font-semibold">
                <Check className="size-3" />
                {allInstalled
                  ? t("marketplace.installed")
                  : `${installedCount}/${detectedAgents.length}`}
              </span>
            )}
          </div>

          {/* Description (short) */}
          {skill.description && (
            <p className="relative text-[12.5px] text-muted-foreground leading-relaxed mt-3 line-clamp-3">
              {skill.description}
            </p>
          )}

          {/* Primary actions */}
          <div className="relative flex items-center gap-2 mt-3.5">
            {!allInstalled && detectedAgents.length > 0 && (
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 flex-1 min-w-[120px]"
                disabled={anyBusy || !skill.repository}
                onClick={() => setInstallDialogOpen(true)}
                title={t("marketplace.oneClickInstallTooltip")}
              >
                {isInstalling ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {isInstalling
                  ? t("marketplace.installing")
                  : hasAnyInstalled
                    ? `${t("marketplace.oneClickInstall")} (${notInstalledAgents.length})`
                    : t("marketplace.oneClickInstall")}
              </Button>
            )}
            {skill.repository && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => openUrl(skill.repository!)}
                title={t("marketplace.viewRepository")}
              >
                <ExternalLink className="size-3.5" />
                {t("marketplace.viewRepository")}
              </Button>
            )}
          </div>
        </div>

        {/* === Per-agent install status — collapsed by default === */}
        {detectedAgents.length > 0 && (
          <CollapsibleSection
            label={t("marketplace.agentsLabel", {
              installed: installedAgentCount(localSkill, detectedAgents),
              total: detectedAgents.length,
            })}
            badge={
              hasAnyInstalled ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-px text-[9.5px] font-bold leading-none">
                  <Check className="size-2.5" />
                  {installedCount}/{detectedAgents.length}
                </span>
              ) : (
                <span className="rounded-full bg-black/6 dark:bg-white/8 text-muted-foreground px-1.5 py-px text-[9.5px] font-bold leading-none tabular-nums">
                  0/{detectedAgents.length}
                </span>
              )
            }
            defaultCollapsed
          >
            <SkillAgentList
              skill={localSkill}
              skillIdOverride={skill.name}
              detectedAgents={detectedAgents}
              busyAgents={busyAgents}
              onInstall={onInstall}
              onUninstall={(skillId, agentSlug) => onUninstall(skillId, agentSlug)}
            />
          </CollapsibleSection>
        )}

        {/* === AI Explain (NEW) — uses remote SKILL.md content === */}
        {skill.repository && (
          <AISkillExplainer
            cacheKey={`marketplace:${skillKey(skill)}`}
            skillName={skill.name}
            content={remoteContent ?? ""}
            contentLoading={isStale || contentLoading}
          />
        )}

        {/* === Skill Content (full SKILL.md) === */}
        <InfoSection label={t("marketplace.skillContent")}>
          {isStale || contentLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("marketplace.loading")}
            </div>
          ) : remoteContent ? (
            <MarkdownContent content={remoteContent} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {skill.repository
                ? t("marketplace.couldNotLoad")
                : t("marketplace.noRepoUrl")}
            </p>
          )}
        </InfoSection>

        {/* === Package Info (compact, secondary) === */}
        <InfoSection label={t("marketplace.packageInfo")}>
          <InfoGrid>
            {skill.repository && (
              <InfoRow label={t("marketplace.repository")}>
                <button
                  className="text-xs text-primary hover:underline font-mono break-all text-left inline-flex items-start gap-1 cursor-pointer"
                  onClick={() => openUrl(skill.repository!)}
                >
                  {skill.repository}
                  <ExternalLink className="size-3 shrink-0 mt-0.5" />
                </button>
              </InfoRow>
            )}
            {skill.installs != null && (
              <InfoRow label={t("marketplace.installs")}>
                <span className="text-xs font-medium tabular-nums">
                  {formatInstalls(skill.installs)}
                </span>
                <span className="text-xs text-muted-foreground/60 ml-1.5 tabular-nums">
                  ({skill.installs.toLocaleString()})
                </span>
              </InfoRow>
            )}
          </InfoGrid>
        </InfoSection>

        {/* === Quick links === */}
        {(skill.source === "skills.sh" || skill.source === "skillhub") && (
          <div className="flex items-center gap-2 pt-1">
            {skill.source === "skills.sh" && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs h-7 text-muted-foreground hover:text-foreground"
                onClick={() => openUrl("https://skills.sh")}
              >
                <Tag className="size-3" />
                {t("marketplace.viewOnSkillsSh")}
              </Button>
            )}
            {skill.source === "skillhub" && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs h-7 text-muted-foreground hover:text-foreground"
                onClick={() => openUrl("https://skillhub.cn")}
              >
                <Tag className="size-3" />
                {t("marketplace.viewOnSkillHub")}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* === One-click install dialog === */}
      {installDialogOpen && (
        <OneClickInstallDialog
          skillName={skill.name}
          allAgents={detectedAgents}
          installedSlugs={
            new Set(
              localSkill ? localSkill.installations.map((i) => i.agent_slug) : [],
            )
          }
          busy={isInstalling}
          onClose={() => setInstallDialogOpen(false)}
          onConfirm={(slugs) => {
            setInstallDialogOpen(false);
            onInstall(slugs);
          }}
        />
      )}
    </div>
  );
}

function skillKey(skill: MarketplaceSkill): string {
  return `${skill.source}|${normalizeRepoUrl(skill.repository) ?? "no-repo"}|${skill.name}`;
}

function InfoSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </p>
      {children}
    </div>
  );
}

// ============================================================
//  OneClickInstallDialog
//  - Default: not-installed agents are pre-selected
//  - Already-installed agents can be selected to re-sync
//  - ESC closes the dialog
// ============================================================
function OneClickInstallDialog({
  skillName,
  allAgents,
  installedSlugs,
  busy,
  onClose,
  onConfirm,
}: {
  skillName: string;
  allAgents: AgentConfig[];
  installedSlugs: Set<string>;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (slugs: string[]) => void;
}) {
  const { t } = useTranslation();
  // Default: pre-select all not-installed agents
  const [selected, setSelected] = useState<Set<string>>(() => {
    const next = new Set<string>();
    allAgents.forEach((a) => {
      if (!installedSlugs.has(a.slug)) next.add(a.slug);
    });
    // If everything is already installed, default-select all (re-install/re-sync)
    if (next.size === 0) allAgents.forEach((a) => next.add(a.slug));
    return next;
  });

  const toggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const allSelected = selected.size === allAgents.length;
  const noneSelected = selected.size === 0;
  const selectAll = () => setSelected(new Set(allAgents.map((a) => a.slug)));
  const selectNone = () => setSelected(new Set());

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (allAgents.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 backdrop-blur-md animate-fade-in"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-[480px] max-w-[92vw] rounded-2xl glass-dialog p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold flex items-center gap-1.5">
              <Download className="size-4 text-primary" />
              {t("marketplace.oneClickInstallTitle")}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {t("marketplace.oneClickInstallDesc", { name: skillName })}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={busy}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Quick toggles */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground tabular-nums">
            {t("marketplace.oneClickInstallSelected", {
              selected: selected.size,
              total: allAgents.length,
            })}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={selectAll}
              disabled={busy || allSelected}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                allSelected
                  ? "text-muted-foreground/40 cursor-default"
                  : "text-primary hover:bg-primary/10",
              )}
            >
              {t("marketplace.oneClickInstallSelectAll")}
            </button>
            <span className="text-muted-foreground/30">·</span>
            <button
              type="button"
              onClick={selectNone}
              disabled={busy || noneSelected}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                noneSelected
                  ? "text-muted-foreground/40 cursor-default"
                  : "text-muted-foreground hover:bg-black/4 dark:hover:bg-white/4 hover:text-foreground",
              )}
            >
              {t("marketplace.oneClickInstallSelectNone")}
            </button>
          </div>
        </div>

        {/* Agent list with checkboxes */}
        <div className="space-y-1 max-h-[320px] overflow-y-auto -mx-1 px-1">
          {allAgents.map((agent) => {
            const checked = selected.has(agent.slug);
            const alreadyInstalled = installedSlugs.has(agent.slug);
            return (
              <button
                key={agent.slug}
                type="button"
                disabled={busy}
                onClick={() => toggle(agent.slug)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all",
                  checked
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "hover:bg-black/4 dark:hover:bg-white/4",
                  busy && "opacity-50",
                )}
              >
                <div
                  className={cn(
                    "size-4 rounded shrink-0 flex items-center justify-center transition-all",
                    checked
                      ? "bg-primary text-primary-foreground"
                      : "border border-muted-foreground/40",
                  )}
                >
                  {checked && <Check className="size-3" />}
                </div>
                <MarketplaceAgentIcon slug={agent.slug} />
                <span className="text-sm font-medium flex-1 min-w-0 truncate">
                  {agent.name}
                </span>
                {alreadyInstalled && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-px text-[9px] font-bold leading-none">
                    <Check className="size-2.5" />
                    {t("marketplace.oneClickInstallAlreadyInstalled")}
                  </span>
                )}
                {agent.detected && !alreadyInstalled && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-px text-[9px] font-medium leading-none">
                    <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                    {t("dashboard.detected")}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <p className="text-[10px] text-muted-foreground/70">
            {t("marketplace.oneClickInstallHint")}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              {t("marketplace.oneClickInstallCancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={selected.size === 0 || busy}
              onClick={() => onConfirm(Array.from(selected))}
              className="gap-1.5"
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              <Download className="size-3" />
              {t("marketplace.oneClickInstallConfirm", { count: selected.size })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Local agent icon helper (renders Component or <img>) */
function MarketplaceAgentIcon({ slug }: { slug: string }) {
  const icon = getAgentIcon(slug);
  return icon.type === "component" ? (
    <icon.Component className="size-3.5 rounded-[3px] shrink-0" aria-hidden="true" />
  ) : (
    <img
      src={icon.src}
      alt=""
      className={cn(
        "size-3.5 rounded-[3px] shrink-0 object-contain",
        icon.monochrome && "dark:invert",
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Collapsible section with a clickable header.
 * - Header shows label + optional right-side badge + chevron
 * - Content reveals on click; defaults to collapsed when `defaultCollapsed` is true
 */
function CollapsibleSection({
  label,
  badge,
  defaultCollapsed = false,
  children,
}: {
  label: string;
  badge?: React.ReactNode;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 mb-2 group cursor-pointer rounded-md -mx-1 px-1 py-1 hover:bg-black/3 dark:hover:bg-white/4 transition-colors"
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <ChevronDown
            className={cn(
              "size-3 text-muted-foreground/60 transition-transform shrink-0",
              !open && "-rotate-90",
            )}
          />
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
            {label}
          </span>
        </span>
        {badge && <span className="shrink-0">{badge}</span>}
      </button>
      {open && <div className="animate-fade-in">{children}</div>}
    </div>
  );
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
      {children}
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <div>{children}</div>
    </>
  );
}

/** Find the matching local skill for a marketplace skill, checking repo URL when available */
function findLocalSkill(
  localSkills: Skill[] | undefined,
  skillName: string,
  repoUrl: string | null | undefined,
): Skill | undefined {
  if (!localSkills?.length) return undefined;
  const remoteRepo = normalizeRepoUrl(repoUrl);
  return localSkills.find((s) => {
    const nameMatches = s.name === skillName || s.id === skillName;
    if (!nameMatches) return false;
    if (remoteRepo) {
      const localRepo = normalizeRepoUrl(sourceRepository(s.source));
      if (localRepo) return localRepo === remoteRepo;
    }
    return true;
  });
}

function sourceRepository(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if ("GitRepository" in src) {
    const git = src["GitRepository"] as Record<string, unknown>;
    return typeof git.repo_url === "string" ? git.repo_url : null;
  }
  if ("SkillsSh" in src) {
    const skillsSh = src["SkillsSh"] as Record<string, unknown>;
    return typeof skillsSh.repository === "string" ? skillsSh.repository : null;
  }
  if ("ClawHub" in src) {
    const clawHub = src["ClawHub"] as Record<string, unknown>;
    return typeof clawHub.repository === "string" ? clawHub.repository : null;
  }
  if ("SkillHub" in src) {
    const skillHub = src["SkillHub"] as Record<string, unknown>;
    return typeof skillHub.repository === "string" ? skillHub.repository : null;
  }
  return null;
}

function normalizeRepoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

function formatInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
