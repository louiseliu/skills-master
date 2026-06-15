import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Puzzle,
  MonitorCheck,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  Copy,
  X,
  ChevronDown,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Bell,
  Store,
  GitBranch,
  Folder,
  Download,
  TrendingUp,
  PartyPopper,
  Settings,
} from "lucide-react";
import { getAgentIcon } from "@/lib/agentIcons";
import { useAgents, type AgentConfig } from "@/hooks/useAgents";
import { useSkills, installedAgents, type Skill } from "@/hooks/useSkills";
import { useAIConfig } from "@/hooks/useAISettings";
import LiquidGlass from "@/components/LiquidGlass";
import { Button } from "@/components/ui/button";
import SearchInput from "@/components/SearchInput";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import AISearchBar from "@/components/AISearchBar";

// === Source classification helpers (mirrors SkillsManager.getSourceKind) ===
type SourceKind = "market" | "git" | "local" | "unknown";

function getSourceKind(source: unknown): SourceKind {
  if (!source || typeof source !== "object") return "unknown";
  const src = source as Record<string, unknown>;
  if ("LocalPath" in src) return "local";
  if ("GitRepository" in src) return "git";
  if ("SkillsSh" in src || "ClawHub" in src || "SkillHub" in src) return "market";
  return "unknown";
}

/** Is this skill updatable? Currently means "has Git/Market origin (can pull)". */
function isUpdatableSource(source: unknown): boolean {
  const kind = getSourceKind(source);
  return kind === "git" || kind === "market";
}

/** Time-based greeting key */
function getGreetingKey(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return "dashboard.heroGreetingMorning";
  if (h >= 11 && h < 13) return "dashboard.heroGreetingNoon";
  if (h >= 13 && h < 18) return "dashboard.heroGreetingAfternoon";
  if (h >= 18 && h < 23) return "dashboard.heroGreetingEvening";
  return "dashboard.heroGreetingNight";
}

type GroupedItem =
  | { kind: "agent"; agent: AgentConfig }
  | { kind: "group"; groupKey: string; agents: AgentConfig[] };

export default function Dashboard() {
  const { t } = useTranslation();
  const {
    data: agents,
    isLoading: agentsLoading,
    isFetching: agentsFetching,
    refetch: refetchAgents,
  } = useAgents();
  const {
    data: skills,
    isLoading: skillsLoading,
    isFetching: skillsFetching,
    refetch: refetchSkills,
  } = useSkills();
  const { data: aiConfig } = useAIConfig();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "detected" | "not-installed">("all");
  const [sortBy, setSortBy] = useState<"name" | "skills">("name");
  const [guideAgent, setGuideAgent] = useState<string | null>(null);

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];
  const totalSkills = skills?.length ?? 0;
  const isRefreshing = agentsFetching || skillsFetching;
  const isAIConfigured = !!aiConfig?.enabled && !!aiConfig?.has_api_key;
  const hasAnyAgents = detectedAgents.length > 0;
  const noAgentsAtAll = !agentsLoading && (agents?.length ?? 0) === 0;
  const isFirstRun = !agentsLoading && !skillsLoading && !hasAnyAgents;

  const skillCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents ?? []) {
      counts.set(agent.slug, 0);
    }
    for (const skill of skills ?? []) {
      for (const slug of installedAgents(skill)) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    return counts;
  }, [agents, skills]);

  // === A2 Stats: source distribution + updatable count ===
  const sourceCounts = useMemo(() => {
    const m = { market: 0, git: 0, local: 0, unknown: 0 };
    for (const s of skills ?? []) m[getSourceKind(s.source)]++;
    return m;
  }, [skills]);

  const updatableCount = useMemo(
    () => skills?.filter((s) => isUpdatableSource(s.source)).length ?? 0,
    [skills],
  );

  // === A3 Todo banner: skills installed somewhere but not on every detected agent ===
  const unsyncedCount = useMemo(() => {
    if (!skills?.length || detectedAgents.length === 0) return 0;
    return skills.filter((s) => {
      const installed = new Set(installedAgents(s));
      if (installed.size === 0) return false;
      return installed.size < detectedAgents.length;
    }).length;
  }, [skills, detectedAgents]);

  const todoCount = updatableCount + unsyncedCount + (noAgentsAtAll ? 1 : 0);

  const filteredAgents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return (agents ?? [])
      .filter((agent) => {
        if (!query) return true;
        const haystack = [
          agent.name,
          agent.slug,
          agent.cli_command ?? "",
          ...agent.global_paths,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .filter((agent) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "detected") return agent.detected;
        return !agent.detected;
      })
      .sort((a, b) => {
        if (sortBy === "skills") {
          const bySkills = (skillCountByAgent.get(b.slug) ?? 0) - (skillCountByAgent.get(a.slug) ?? 0);
          if (bySkills !== 0) return bySkills;
        }
        if (a.detected !== b.detected) return a.detected ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [agents, searchTerm, statusFilter, sortBy, skillCountByAgent]);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const groupedItems = useMemo<GroupedItem[]>(() => {
    const items: GroupedItem[] = [];
    const groupBuckets = new Map<string, AgentConfig[]>();

    for (const agent of filteredAgents) {
      if (agent.group) {
        let bucket = groupBuckets.get(agent.group);
        if (!bucket) {
          bucket = [];
          groupBuckets.set(agent.group, bucket);
        }
        bucket.push(agent);
      } else {
        items.push({ kind: "agent", agent });
      }
    }

    const groupItems: GroupedItem[] = [];
    for (const [groupKey, groupAgents] of groupBuckets) {
      groupItems.push({ kind: "group", groupKey, agents: groupAgents });
    }
    groupItems.sort((a, b) => {
      if (a.kind !== "group" || b.kind !== "group") return 0;
      const aDetected = a.agents.filter((ag) => ag.detected).length;
      const bDetected = b.agents.filter((ag) => ag.detected).length;
      if (aDetected !== bDetected) return bDetected - aDetected;
      return a.groupKey.localeCompare(b.groupKey);
    });

    return [...groupItems, ...items];
  }, [filteredAgents]);

  const selectedGuide = useMemo(
    () => (agents ?? []).find((agent) => agent.slug === guideAgent) ?? null,
    [agents, guideAgent]
  );

  return (
    <div className="p-6 space-y-5 animate-fade-in-up">
      {/* === A1 + B2: Hero with greeting + health chips + AI status === */}
      <DashboardHero
        agentsLoading={agentsLoading}
        skillsLoading={skillsLoading}
        detectedAgents={detectedAgents.length}
        totalAgents={agents?.length ?? 0}
        totalSkills={totalSkills}
        updatableCount={updatableCount}
        isAIConfigured={isAIConfigured}
        aiModel={aiConfig?.model ?? null}
        isFirstRun={isFirstRun}
        isRefreshing={isRefreshing}
        onRefresh={() => {
          void Promise.all([refetchAgents(), refetchSkills()]);
        }}
        onConfigureAI={() => navigate("/settings")}
      />

      {/* AI Smart Search */}
      <AISearchBar />

      {/* === A2: Stats row (4 cards) === */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={t("dashboard.statsAgents")}
          hint={t("dashboard.statsAgentsHint")}
          value={agentsLoading ? null : detectedAgents.length}
          total={agents?.length}
          icon={<MonitorCheck className="size-4 text-primary/70" />}
          tone="primary"
        />
        <StatCard
          label={t("dashboard.statsSkills")}
          hint={t("dashboard.statsSkillsHint")}
          value={skillsLoading ? null : totalSkills}
          icon={<Puzzle className="size-4 text-primary/70" />}
          tone="primary"
        />
        <StatCard
          label={t("dashboard.statsUpdatable")}
          hint={t("dashboard.statsUpdatableHint")}
          value={skillsLoading ? null : updatableCount}
          icon={<Download className="size-4 text-amber-500" />}
          tone={updatableCount > 0 ? "warn" : "muted"}
        />
        <SourceDistributionCard counts={sourceCounts} loading={skillsLoading} />
      </div>

      {/* === A3 + B1: Todo banner OR welcome card === */}
      {isFirstRun ? (
        <WelcomeCard
          onBrowseMarket={() => navigate("/marketplace")}
        />
      ) : (
        <TodoBanner
          todoCount={todoCount}
          updatableCount={updatableCount}
          unsyncedCount={unsyncedCount}
          noAgentsAtAll={noAgentsAtAll}
          onUpdateClick={() => navigate("/skills")}
          onUnsyncedClick={() => navigate("/skills")}
          onNoAgentsClick={() => {
            const firstAgent = agents?.[0];
            if (firstAgent) setGuideAgent(firstAgent.slug);
          }}
          loading={skillsLoading || agentsLoading}
        />
      )}

      {/* Agent cards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("dashboard.agents")}
          </h2>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {t("dashboard.detectedOf", { detected: detectedAgents.length, total: agents?.length ?? 0 })}
          </span>
        </div>

        {/* === A5: Search + segmented filter chips === */}
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:flex-wrap">
          <div className="w-full md:max-w-[280px] md:shrink-0">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={t("dashboard.searchPlaceholder")}
              debounce={0}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <DashboardFilterChip
              active={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
              label={t("dashboard.filterAll")}
              count={agents?.length ?? 0}
            />
            <DashboardFilterChip
              active={statusFilter === "detected"}
              onClick={() => setStatusFilter("detected")}
              label={t("dashboard.filterDetected")}
              count={detectedAgents.length}
              tone="success"
            />
            <DashboardFilterChip
              active={statusFilter === "not-installed"}
              onClick={() => setStatusFilter("not-installed")}
              label={t("dashboard.filterNotInstalled")}
              count={(agents?.length ?? 0) - detectedAgents.length}
            />
            {/* Sort segmented control */}
            <span className="mx-1 text-muted-foreground/30">·</span>
            <DashboardFilterChip
              active={sortBy === "name"}
              onClick={() => setSortBy("name")}
              label={t("dashboard.sortName")}
            />
            <DashboardFilterChip
              active={sortBy === "skills"}
              onClick={() => setSortBy("skills")}
              label={t("dashboard.sortSkills")}
            />
          </div>
        </div>
        {agentsLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl p-4 glass">
                <div className="flex items-start gap-3">
                  <div className="size-9 rounded-lg animate-skeleton shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-24 rounded animate-skeleton" />
                    <div className="h-3 w-16 rounded animate-skeleton" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : groupedItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("dashboard.noAgentsMatch")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {groupedItems.map((item) => {
              if (item.kind === "group") {
                const { groupKey, agents: groupAgents } = item;
                const detectedCount = groupAgents.filter((a) => a.detected).length;
                const isExpanded = expandedGroups.has(groupKey);
                const representativeSlug = groupAgents.find((a) => a.slug === "openclaw")?.slug
                  ?? groupAgents.find((a) => a.detected)?.slug
                  ?? groupAgents[0]?.slug
                  ?? groupKey;
                const groupSkillCount = groupAgents.reduce(
                  (sum, a) => sum + (skillCountByAgent.get(a.slug) ?? 0),
                  0,
                );

                return (
                  <div key={`group-${groupKey}`} className="col-span-full">
                    <LiquidGlass
                      className="group flex items-center gap-3 rounded-2xl p-4 text-left glass-hover cursor-pointer"
                      onClick={() => toggleGroup(groupKey)}
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                        {(() => {
                          const icon = getAgentIcon(representativeSlug);
                          return icon.type === "component"
                            ? <icon.Component className="size-6 rounded-[3px]" aria-hidden="true" />
                            : <img src={icon.src} alt="" className={`size-6 rounded-[3px] ${icon.monochrome ? "dark:invert" : ""}`} />;
                        })()}
                      </div>
                      <div className="flex-1 min-w-0 relative z-3">
                        <span className="text-sm font-semibold capitalize">
                          {groupKey}
                        </span>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("dashboard.groupTotal", { count: groupAgents.length })}
                          {" · "}
                          {t("dashboard.groupDetected", { detected: detectedCount })}
                          {groupSkillCount > 0 && (
                            <> · {t("dashboard.skillCount", { count: groupSkillCount })}</>
                          )}
                        </p>
                      </div>
                      <ChevronDown
                        className={cn(
                          "size-4 text-muted-foreground shrink-0 transition-transform duration-200 relative z-3",
                          isExpanded && "rotate-180",
                        )}
                      />
                    </LiquidGlass>
                    {isExpanded && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 mt-2 ml-4 animate-fade-in-up">
                        {groupAgents.map((agent) => (
                          <AgentCard
                            key={agent.slug}
                            agent={agent}
                            skillCount={skillCountByAgent.get(agent.slug) ?? 0}
                            onNavigate={() => navigate("/skills?agent=" + agent.slug)}
                            onGuide={() => setGuideAgent(agent.slug)}
                            t={t}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <AgentCard
                  key={item.agent.slug}
                  agent={item.agent}
                  skillCount={skillCountByAgent.get(item.agent.slug) ?? 0}
                  onNavigate={() => navigate("/skills?agent=" + item.agent.slug)}
                  onGuide={() => setGuideAgent(item.agent.slug)}
                  t={t}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Recent skills */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("dashboard.recentSkills")}
          </h2>
          {totalSkills > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => navigate("/skills")}
            >
              {t("dashboard.viewAll")}
              <ArrowRight className="size-3" />
            </Button>
          )}
        </div>
        {skillsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl px-4 py-3 glass">
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 rounded animate-skeleton" />
                    <div className="h-3 w-48 rounded animate-skeleton" />
                  </div>
                  <div className="h-5 w-14 rounded-full animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : !skills?.length ? (
          <div className="rounded-2xl border border-dashed border-black/6 dark:border-white/6 p-10 text-center">
            <div className="inline-flex size-14 items-center justify-center rounded-2xl glass mb-4">
              <Puzzle className="size-7 text-primary/40" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.noSkillsYet")}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => navigate("/marketplace")}
            >
              {t("dashboard.browseMarketplace")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {skills.slice(0, 5).map((skill) => (
              <RecentSkillRow
                key={skill.id}
                skill={skill}
                agentNameOf={(slug) => agents?.find((a) => a.slug === slug)?.name ?? slug}
                onClick={() => navigate(`/skills?skill=${encodeURIComponent(skill.id)}`)}
              />
            ))}
          </div>
        )}
      </div>

      <InstallGuideModal
        agent={selectedGuide}
        onClose={() => setGuideAgent(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  hint,
  value,
  total,
  icon,
  tone = "primary",
}: {
  label: string;
  hint?: string;
  value: number | null;
  total?: number;
  icon: React.ReactNode;
  tone?: "primary" | "warn" | "muted";
}) {
  const iconBg =
    tone === "warn"
      ? "bg-amber-500/10"
      : tone === "muted"
        ? "bg-black/4 dark:bg-white/6"
        : "bg-primary/10";
  return (
    <div className="rounded-2xl p-3.5 glass glass-stat glass-shine-always">
      <div className="flex items-center gap-2 mb-2.5">
        <div className={cn("flex size-7 items-center justify-center rounded-xl", iconBg)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-foreground/80 truncate">{label}</p>
          {hint && (
            <p className="text-[9.5px] text-muted-foreground/60 truncate uppercase tracking-wider">
              {hint}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        {value == null ? (
          <div className="h-8 w-10 rounded animate-skeleton" />
        ) : (
          <span
            className={cn(
              "text-2xl font-bold tabular-nums tracking-tight",
              tone === "warn" && value > 0 && "text-amber-600 dark:text-amber-400",
            )}
          >
            {value}
          </span>
        )}
        {total != null && value != null && (
          <span className="text-sm text-muted-foreground/60 font-medium">/ {total}</span>
        )}
      </div>
    </div>
  );
}

// ============================================================
//  A1 + B2: Dashboard Hero
//  Greeting + subtitle + health chips + AI status + refresh
// ============================================================
function DashboardHero({
  agentsLoading,
  skillsLoading,
  detectedAgents,
  totalAgents,
  totalSkills,
  updatableCount,
  isAIConfigured,
  aiModel,
  isFirstRun,
  isRefreshing,
  onRefresh,
  onConfigureAI,
}: {
  agentsLoading: boolean;
  skillsLoading: boolean;
  detectedAgents: number;
  totalAgents: number;
  totalSkills: number;
  updatableCount: number;
  isAIConfigured: boolean;
  aiModel: string | null;
  isFirstRun: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onConfigureAI: () => void;
}) {
  const { t } = useTranslation();
  const greeting = t(getGreetingKey());
  const isLoading = agentsLoading || skillsLoading;

  return (
    <div className="relative rounded-2xl overflow-hidden glass-panel p-5">
      {/* Decorative orbs */}
      <div
        className="pointer-events-none absolute -top-20 -right-20 size-56 rounded-full bg-linear-to-br from-primary/20 via-primary/5 to-transparent blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-16 -left-16 size-40 rounded-full bg-linear-to-tr from-emerald-500/8 via-transparent to-transparent blur-3xl"
        aria-hidden="true"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="size-4 text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              {t("dashboard.title")}
            </span>
          </div>
          <h1 className="text-xl font-bold leading-tight mt-1">
            {greeting} 👋
          </h1>
          <p className="text-[12.5px] text-muted-foreground mt-1">
            {isFirstRun
              ? t("dashboard.heroSubtitleEmpty")
              : t("dashboard.heroSubtitle", {
                  agents: detectedAgents,
                  skills: totalSkills,
                })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={isRefreshing}
          onClick={onRefresh}
          title={t("dashboard.refreshTitle")}
          className="shrink-0"
        >
          <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
        </Button>
      </div>

      {/* === Health chips === */}
      {!isLoading && (
        <div className="relative flex items-center gap-1.5 mt-3.5 flex-wrap">
          {/* AI status */}
          <button
            type="button"
            onClick={isAIConfigured ? undefined : onConfigureAI}
            disabled={isAIConfigured}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium transition-colors",
              isAIConfigured
                ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 cursor-default"
                : "bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-500/25 hover:bg-amber-500/20 cursor-pointer",
            )}
          >
            <Sparkles className="size-2.5" />
            {isAIConfigured
              ? t("dashboard.heroAIConfigured", { model: aiModel ?? "AI" })
              : t("dashboard.heroAINotConfigured")}
            {!isAIConfigured && (
              <>
                <span className="text-amber-700/40 dark:text-amber-300/40">·</span>
                <span className="inline-flex items-center gap-0.5">
                  <Settings className="size-2.5" />
                  {t("dashboard.heroAIConfigure")}
                </span>
              </>
            )}
          </button>

          {/* Agents */}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium border",
              detectedAgents > 0
                ? "bg-emerald-500/8 text-emerald-700 dark:text-emerald-300 border-emerald-500/15"
                : "bg-black/4 dark:bg-white/4 text-muted-foreground border-transparent",
            )}
          >
            <MonitorCheck className="size-2.5" />
            {t("dashboard.heroHealthAgents", {
              detected: detectedAgents,
              total: totalAgents,
            })}
          </span>

          {/* Skills count */}
          {totalSkills > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium border bg-black/4 dark:bg-white/6 text-foreground/75 border-transparent">
              <Puzzle className="size-2.5" />
              {t("dashboard.heroHealthSkills", { count: totalSkills })}
            </span>
          )}

          {/* Updates */}
          {updatableCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-500/20">
              <Download className="size-2.5" />
              {t("dashboard.heroHealthUpdates", { count: updatableCount })}
            </span>
          ) : (
            !isFirstRun && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium bg-emerald-500/8 text-emerald-700 dark:text-emerald-300 border border-emerald-500/15">
                <CheckCircle2 className="size-2.5" />
                {t("dashboard.heroHealthAllGood")}
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  A2: Source Distribution Card (mini stacked bar + legend)
// ============================================================
function SourceDistributionCard({
  counts,
  loading,
}: {
  counts: { market: number; git: number; local: number; unknown: number };
  loading: boolean;
}) {
  const { t } = useTranslation();
  const total = counts.market + counts.git + counts.local + counts.unknown;
  const has = total > 0;

  const segments = [
    { key: "market", value: counts.market, color: "bg-blue-500", label: t("dashboard.statsSourceMarket"), Icon: Store },
    { key: "git", value: counts.git, color: "bg-purple-500", label: t("dashboard.statsSourceGit"), Icon: GitBranch },
    { key: "local", value: counts.local, color: "bg-emerald-500", label: t("dashboard.statsSourceLocal"), Icon: Folder },
    { key: "unknown", value: counts.unknown, color: "bg-zinc-500", label: t("dashboard.statsSourceUnknown"), Icon: Folder },
  ].filter((s) => s.value > 0);

  return (
    <div className="rounded-2xl p-3.5 glass glass-stat glass-shine-always">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="flex size-7 items-center justify-center rounded-xl bg-primary/10">
          <TrendingUp className="size-4 text-primary/70" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-foreground/80 truncate">
            {t("dashboard.statsSources")}
          </p>
          <p className="text-[9.5px] text-muted-foreground/60 truncate uppercase tracking-wider">
            {t("dashboard.statsSourcesHint")}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full animate-skeleton" />
          <div className="h-3 w-20 rounded animate-skeleton" />
        </div>
      ) : !has ? (
        <p className="text-[11px] text-muted-foreground/60">—</p>
      ) : (
        <>
          {/* Stacked bar */}
          <div className="flex h-1.5 rounded-full overflow-hidden bg-black/4 dark:bg-white/6 mb-1.5">
            {segments.map((s) => (
              <div
                key={s.key}
                className={s.color}
                style={{ width: `${(s.value / total) * 100}%` }}
                title={`${s.label}: ${s.value}`}
              />
            ))}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
            {segments.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-0.5 tabular-nums">
                <span className={cn("size-1.5 rounded-full", s.color)} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-semibold text-foreground/80">{s.value}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
//  A3: Todo Banner — surfaces actionable items
// ============================================================
function TodoBanner({
  todoCount,
  updatableCount,
  unsyncedCount,
  noAgentsAtAll,
  onUpdateClick,
  onUnsyncedClick,
  onNoAgentsClick,
  loading,
}: {
  todoCount: number;
  updatableCount: number;
  unsyncedCount: number;
  noAgentsAtAll: boolean;
  onUpdateClick: () => void;
  onUnsyncedClick: () => void;
  onNoAgentsClick: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="rounded-2xl p-4 glass-panel">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl animate-skeleton" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-32 rounded animate-skeleton" />
            <div className="h-3 w-48 rounded animate-skeleton" />
          </div>
        </div>
      </div>
    );
  }

  if (todoCount === 0) {
    return (
      <div className="rounded-2xl p-4 glass relative overflow-hidden">
        <div
          className="pointer-events-none absolute -top-8 -right-8 size-28 rounded-full bg-linear-to-br from-emerald-500/10 to-transparent blur-2xl"
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <div className="size-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
            <CheckCircle2 className="size-5 text-emerald-500" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("dashboard.todoNoneTitle")}</p>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">
              {t("dashboard.todoNoneSubtitle")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 glass relative overflow-hidden border border-amber-500/15">
      <div
        className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-linear-to-br from-amber-500/10 via-amber-500/4 to-transparent blur-3xl"
        aria-hidden="true"
      />

      <div className="relative">
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="size-7 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
            <Bell className="size-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12.5px] font-semibold">
              {t("dashboard.todoTitle", { count: todoCount })}
            </p>
          </div>
        </div>

        <div className="space-y-1.5 ml-10">
          {noAgentsAtAll && (
            <TodoRow
              icon={<MonitorCheck className="size-3.5" />}
              label={t("dashboard.todoNoAgentsLabel")}
              actionLabel={t("dashboard.todoNoAgentsAction")}
              onClick={onNoAgentsClick}
              tone="amber"
            />
          )}
          {updatableCount > 0 && (
            <TodoRow
              icon={<Download className="size-3.5" />}
              label={t("dashboard.todoUpdatesLabel", { count: updatableCount })}
              actionLabel={t("dashboard.todoUpdatesAction")}
              onClick={onUpdateClick}
              tone="amber"
            />
          )}
          {unsyncedCount > 0 && (
            <TodoRow
              icon={<RefreshCw className="size-3.5" />}
              label={t("dashboard.todoUnsyncedLabel", { count: unsyncedCount })}
              actionLabel={t("dashboard.todoUnsyncedAction")}
              onClick={onUnsyncedClick}
              tone="primary"
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TodoRow({
  icon,
  label,
  actionLabel,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  actionLabel: string;
  onClick: () => void;
  tone: "amber" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors group",
        tone === "amber"
          ? "hover:bg-amber-500/8"
          : "hover:bg-primary/8",
      )}
    >
      <span className="inline-flex items-center gap-2 min-w-0 flex-1">
        <span
          className={cn(
            "shrink-0",
            tone === "amber"
              ? "text-amber-600 dark:text-amber-400"
              : "text-primary",
          )}
        >
          {icon}
        </span>
        <span className="text-[12px] truncate text-foreground/85">{label}</span>
      </span>
      <span
        className={cn(
          "shrink-0 inline-flex items-center gap-0.5 text-[11px] font-semibold transition-transform group-hover:translate-x-0.5",
          tone === "amber"
            ? "text-amber-700 dark:text-amber-300"
            : "text-primary",
        )}
      >
        {actionLabel}
        <ArrowRight className="size-3" />
      </span>
    </button>
  );
}

// ============================================================
//  B1: Welcome Card — shown on first run (no agents detected)
// ============================================================
function WelcomeCard({ onBrowseMarket }: { onBrowseMarket: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl p-5 relative overflow-hidden glass-panel border border-primary/15">
      <div
        className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-linear-to-br from-primary/15 via-primary/5 to-transparent blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-12 -left-12 size-40 rounded-full bg-linear-to-tr from-emerald-500/10 to-transparent blur-3xl"
        aria-hidden="true"
      />

      <div className="relative flex items-center gap-2 mb-1">
        <PartyPopper className="size-4 text-primary" />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-primary">
          Skills Master
        </span>
      </div>
      <h2 className="relative text-lg font-bold leading-tight">
        {t("dashboard.welcomeTitle")}
      </h2>
      <p className="relative text-[12.5px] text-muted-foreground mt-1">
        {t("dashboard.welcomeSubtitle")}
      </p>

      <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
        <WelcomeStep
          title={t("dashboard.welcomeStep1Title")}
          desc={t("dashboard.welcomeStep1Desc")}
          icon={<MonitorCheck className="size-4 text-primary" />}
        />
        <WelcomeStep
          title={t("dashboard.welcomeStep2Title")}
          desc={t("dashboard.welcomeStep2Desc")}
          icon={<Store className="size-4 text-primary" />}
        />
        <WelcomeStep
          title={t("dashboard.welcomeStep3Title")}
          desc={t("dashboard.welcomeStep3Desc")}
          icon={<Download className="size-4 text-primary" />}
        />
      </div>

      <div className="relative flex items-center gap-2 mt-4">
        <Button onClick={onBrowseMarket} size="sm" className="gap-1.5">
          <Store className="size-3.5" />
          {t("dashboard.welcomeBrowseMarket")}
          <ArrowUpRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function WelcomeStep({
  title,
  desc,
  icon,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-black/3 dark:bg-white/4 p-3 ring-1 ring-black/4 dark:ring-white/6">
      <div className="flex items-center gap-1.5">
        <div className="size-6 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <p className="text-[11.5px] font-semibold truncate">{title}</p>
      </div>
      <p className="text-[10.5px] text-muted-foreground mt-1.5 leading-relaxed">
        {desc}
      </p>
    </div>
  );
}

// ============================================================
//  A5: Filter chip used in the agents section
// ============================================================
function DashboardFilterChip({
  active,
  onClick,
  label,
  count,
  tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  tone?: "default" | "success";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all border",
        active
          ? tone === "success"
            ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
            : "bg-primary/12 text-primary border-primary/25"
          : "bg-transparent text-muted-foreground border-transparent hover:bg-black/4 dark:hover:bg-white/4",
      )}
    >
      <span>{label}</span>
      {count != null && count > 0 && (
        <span
          className={cn(
            "inline-flex items-center justify-center min-w-[16px] h-[14px] rounded-full px-1 text-[9.5px] tabular-nums",
            active
              ? tone === "success"
                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                : "bg-primary/15 text-primary"
              : "bg-black/6 dark:bg-white/8 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ============================================================
//  A4: Recent skill row — source badge + agent chips + click-through
// ============================================================
function RecentSkillRow({
  skill,
  agentNameOf,
  onClick,
}: {
  skill: Skill;
  agentNameOf: (slug: string) => string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const installed = installedAgents(skill);
  const sourceKind = getSourceKind(skill.source);
  const sourceMeta: Record<SourceKind, { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> } | null> = {
    market: { label: t("dashboard.recentBadgeMarket"), cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", Icon: Store },
    git: { label: t("dashboard.recentBadgeGit"), cls: "bg-purple-500/15 text-purple-700 dark:text-purple-300", Icon: GitBranch },
    local: { label: t("dashboard.recentBadgeLocal"), cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", Icon: Folder },
    unknown: null,
  };
  const meta = sourceMeta[sourceKind];

  return (
    <LiquidGlass
      className="group flex items-center justify-between rounded-2xl px-4 py-2.5 glass-hover cursor-pointer"
      onClick={onClick}
    >
      <div className="min-w-0 flex-1 relative z-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{skill.name}</span>
          {meta && (
            <span
              className={cn(
                "shrink-0 inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider",
                meta.cls,
              )}
            >
              <meta.Icon className="size-2.5" />
              {meta.label}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="text-[11.5px] text-muted-foreground truncate mt-0.5 leading-relaxed">
            {skill.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3 relative z-3">
        {installed.length > 0 && (
          <span
            className="text-[10px] text-muted-foreground tabular-nums"
            title={installed.map(agentNameOf).join(", ")}
          >
            {t("dashboard.recentInstalledOnAgents", { count: installed.length })}
          </span>
        )}
        <ArrowRight className="size-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
      </div>
    </LiquidGlass>
  );
}

function InstallGuideModal({
  agent,
  onClose,
}: {
  agent: {
    slug: string;
    name: string;
    cli_command: string | null;
    install_command: string | null;
    install_command_windows: string | null;
    install_docs_url: string | null;
    install_source_label: string | null;
    global_paths: string[];
  } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agent) return;
    panelRef.current?.focus();
  }, [agent]);

  if (!agent) return null;
  const isWindows = navigator.userAgent.includes("Windows");
  const installCommand = (isWindows
    ? agent.install_command_windows ?? agent.install_command
    : agent.install_command
  )?.trim();

  function formatInstallSourceLabel(label: string | null): string {
    switch (label) {
      case "official-docs":
        return t("dashboard.sourceOfficialDocs");
      case "official-help-center":
        return t("dashboard.sourceOfficialHelpCenter");
      case "official-readme":
        return t("dashboard.sourceOfficialReadme");
      case "official-marketplace":
        return t("dashboard.sourceOfficialMarketplace");
      case "homebrew-cask":
        return t("dashboard.sourceHomebrewCask");
      default:
        return t("dashboard.sourceUnspecified");
    }
  }

  const installSourceLabel = formatInstallSourceLabel(agent.install_source_label);
  const verifyCommand = agent.cli_command
    ? `${agent.cli_command} --version`
    : "";
  const lookupCommand = agent.cli_command
    ? `which ${agent.cli_command}`
    : "";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 dark:bg-black/60 backdrop-blur-md p-4 animate-backdrop-in"
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-guide-dialog-title"
        className="w-full max-w-lg rounded-3xl p-5 outline-none animate-modal-in glass-dialog"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 id="install-guide-dialog-title" className="text-sm font-semibold">
            {t("dashboard.installGuideTitle", { name: agent.name })}
          </h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{t("dashboard.source")}</span>
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {installSourceLabel}
            </span>
          </div>
          <p>{t("dashboard.diagnoseTip")}</p>
          {verifyCommand ? (
            <CommandBlock label={t("dashboard.versionCheck")} command={verifyCommand} />
          ) : null}
          {lookupCommand ? (
            <CommandBlock label={t("dashboard.pathLookup")} command={lookupCommand} />
          ) : null}
          {installCommand ? (
            <CommandBlock label={t("dashboard.installCommand")} command={installCommand} />
          ) : null}
          {agent.install_docs_url?.trim() ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => openUrl(agent.install_docs_url!)}
            >
              {t("dashboard.openDocs")}
            </Button>
          ) : null}
          <div>
            <p className="mb-1 font-medium text-foreground">{t("dashboard.expectedPaths")}</p>
            <ul className="space-y-1">
              {agent.global_paths.map((path) => (
                <li key={path} className="font-mono text-[11px]">
                  {path}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  skillCount,
  onNavigate,
  onGuide,
  t,
}: {
  agent: AgentConfig;
  skillCount: number;
  onNavigate: () => void;
  onGuide: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <LiquidGlass
      className={cn(
        "group flex items-center gap-3 rounded-2xl p-4 text-left glass-hover cursor-pointer transition-all",
        agent.detected
          ? "ring-1 ring-emerald-500/15 hover:ring-emerald-500/25"
          : "ring-1 ring-black/4 dark:ring-white/4",
      )}
      onClick={() => {
        if (agent.detected) onNavigate();
        else onGuide();
      }}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted relative",
          !agent.detected && "grayscale opacity-50",
        )}
      >
        {(() => {
          const icon = getAgentIcon(agent.slug);
          return icon.type === "component"
            ? <icon.Component className="size-6 rounded-[3px]" aria-hidden="true" />
            : <img src={icon.src} alt="" className={`size-6 rounded-[3px] ${icon.monochrome ? "dark:invert" : ""}`} />;
        })()}
        {agent.detected && (
          <span
            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-background"
            title={t("dashboard.detected")}
          />
        )}
      </div>
      <div className="flex-1 min-w-0 relative z-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{agent.name}</span>
        </div>
        {agent.detected ? (
          <p className="text-[11px] text-muted-foreground mt-1 inline-flex items-center gap-1">
            <Puzzle className="size-2.5" />
            {t("dashboard.skillCount", { count: skillCount })}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground mt-1 inline-flex items-center gap-1">
            <AlertTriangle className="size-2.5" />
            {t("dashboard.notInstalled")}
          </p>
        )}
      </div>
      {/* === A6: Permanent CTA — visible at all times === */}
      <div className="relative z-3 shrink-0">
        {agent.detected ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => { e.stopPropagation(); onNavigate(); }}
            title={agent.name}
            className="text-muted-foreground hover:text-primary group-hover:translate-x-0.5 transition-transform"
          >
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="xs"
            onClick={(e) => { e.stopPropagation(); onGuide(); }}
          >
            {t("dashboard.installationGuide")}
          </Button>
        )}
      </div>
    </LiquidGlass>
  );
}

function CommandBlock({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-xl glass-inset p-2.5">
        <code className="flex-1 break-all text-[11px] text-foreground">{command}</code>
        <Button
          variant="outline"
          size="xs"
          onClick={() => navigator.clipboard.writeText(command)}
        >
          <Copy className="size-3" />
          {t("dashboard.copy")}
        </Button>
      </div>
    </div>
  );
}
