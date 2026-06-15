import { useState, useEffect, useMemo, useCallback, useTransition, useDeferredValue, useRef, memo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Puzzle,
  Copy,
  X,
  Loader2,
  Info,
  Pencil,
  ArrowLeft,
  RefreshCw,
  ChevronRight,
  ArrowUpDown,
  ArrowDownAZ,
  ArrowDownZA,
  CheckSquare,
  ListChecks,
  Trash2,
  Globe,
  Building,
  GitBranch,
  Store,
  FolderOpen,
  Folder,
  FileText,
  Cog,
  Users,
  Package,
  ChevronUp,
  Tag as TagIcon,
  Sparkles,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { useQuery, useQueries, useQueryClient, useIsMutating } from "@tanstack/react-query";
import { useSkills, installedAgents, allAgents, type Skill } from "@/hooks/useSkills";
import { SkillAgentList, installedAgentCount, busyKey, type BusyOp } from "@/components/SkillAgentList";
import { SkillTagsEditor } from "@/components/SkillTagsEditor";
import { aiSuggestSkillTagsKey } from "@/hooks/useSkillTags";
import { useRepos } from "@/hooks/useRepos";
import { useAIConfig } from "@/hooks/useAISettings";

/** Skill extended with optional repo origin */
type SkillWithRepo = Skill & { _repoName?: string };
import { useAgents, type AgentConfig } from "@/hooks/useAgents";
import { useResizable, useResizableY } from "@/hooks/useResizable";
import ResizeHandle from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import SearchInput from "@/components/SearchInput";
import MarkdownContent from "@/components/MarkdownContent";
import AISearchBar from "@/components/AISearchBar";
import AISkillExplainer from "@/components/AISkillExplainer";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/utils";
import { extractMarkdownBody } from "@/lib/markdown";
import { getAgentIcon } from "@/lib/agentIcons";

function FilterAgentIcon({ slug }: { slug: string }) {
  const icon = getAgentIcon(slug);
  return icon.type === "component"
    ? <icon.Component className="size-3.5 rounded-[3px]" aria-hidden="true" />
    : <img src={icon.src} alt="" className={`size-3.5 rounded-[3px] ${icon.monochrome ? "dark:invert" : ""}`} />;
}

function MiniAgentIcon({ slug, dimmed = false }: { slug: string; dimmed?: boolean }) {
  const icon = getAgentIcon(slug);
  const cls = cn("size-3 rounded-[2px] shrink-0", dimmed && "opacity-50");
  return icon.type === "component"
    ? <icon.Component className={cls} aria-hidden="true" />
    : <img src={icon.src} alt="" className={cn(cls, icon.monochrome && "dark:invert")} />;
}

// === Filter dimensions ===
type StatusFilter = "all" | "installed" | "inherited";
type ScopeFilter = "all" | "global" | "local";
type SourceFilter = "all" | "local" | "git" | "market" | "unknown";
type SortKey = "name" | "agents";
type SortDir = "asc" | "desc";
type DetailTab = "overview" | "content" | "metadata" | "agents";

function getSourceKind(source: unknown): SourceFilter {
  if (!source) return "unknown";
  if (typeof source === "string") return source === "Unknown" ? "unknown" : "unknown";
  if (typeof source !== "object") return "unknown";
  const src = source as Record<string, unknown>;
  if ("LocalPath" in src) return "local";
  if ("GitRepository" in src) return "git";
  if ("SkillsSh" in src || "ClawHub" in src || "SkillHub" in src) return "market";
  return "unknown";
}

export default function SkillsManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: skills, isLoading } = useSkills();
  const { data: agents } = useAgents();
  const { data: repos } = useRepos();

  // Fetch skills from all subscribed repos
  const repoSkillQueries = useQueries({
    queries: (repos ?? []).map((repo) => ({
      queryKey: ["repo-skills", repo.id],
      queryFn: () => invoke<Skill[]>("list_repo_skills", { repoIdParam: repo.id }),
      staleTime: 30 * 1000,
    })),
  });

  // Stable data reference for repo skills to avoid re-renders
  const repoSkillsData = repoSkillQueries.map((q) => q.data);

  // Merge local skills + repo skills (dedup by skill id, local wins)
  // For installed skills that match a repo skill, carry over the repo source info
  const mergedSkills = useMemo(() => {
    const localSkills = skills ?? [];
    const localById = new Map(localSkills.map((s) => [s.id, s]));

    // Build a map of repo skill source info by skill id
    const repoSourceById = new Map<string, { source: unknown; repoName: string }>();
    repoSkillsData.forEach((data, idx) => {
      if (data) {
        const repoName = repos?.[idx]?.name ?? "Repo";
        for (const s of data) {
          repoSourceById.set(s.id, { source: s.source, repoName });
        }
      }
    });

    // Enrich local skills with repo source info where available
    const enrichedLocal: SkillWithRepo[] = localSkills.map((s) => {
      const repoInfo = repoSourceById.get(s.id);
      if (repoInfo) {
        return { ...s, source: repoInfo.source, _repoName: repoInfo.repoName };
      }
      return s;
    });

    // Add repo-only skills (not installed locally)
    // Clear their virtual installations so they don't appear as "directly installed"
    const repoOnly: SkillWithRepo[] = [];
    repoSkillsData.forEach((data, idx) => {
      if (data) {
        const repoName = repos?.[idx]?.name ?? "Repo";
        for (const s of data) {
          if (!localById.has(s.id)) {
            repoOnly.push({ ...s, installations: [], _repoName: repoName });
          }
        }
      }
    });

    return [...enrichedLocal, ...repoOnly];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, ...repoSkillsData, repos]);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<string>(
    searchParams.get("agent") ?? "all"
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  // Selected tags act as an AND filter — adding more tags narrows the list.
  // Stored as a Set for O(1) toggle; rendered as sorted array in OverviewPane.
  const [tagFilter, setTagFilter] = useState<Set<string>>(() => new Set());
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyAgents, setBusyAgents] = useState<Map<string, BusyOp>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const isSearchStale = deferredSearch !== searchQuery;
  // selectedId drives list highlight (instant); selectedSkill drives detail (deferred)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isPending, startTransition] = useTransition();
  const [panelMode, setPanelMode] = useState<"detail" | "editor">("detail");
  const listPane = useResizable({
    initial: 320,
    min: 240,
    max: 540,
    storageKey: "skills-list-width",
  });
  // Top pane (overview) height — vertical split: top overview + bottom (list | detail)
  const topPane = useResizableY({
    initial: 320,
    min: 180,
    max: 560,
    storageKey: "skills-top-height",
  });

  // Sync filter from URL — reset selection so auto-select picks the first item
  useEffect(() => {
    const agentParam = searchParams.get("agent") ?? "all";
    setFilter(agentParam);
    setSelectedId(null);
    setSelectedSkill(null);
  }, [searchParams]);

  // Auto-select skill: ONLY when ?selected= is provided in URL.
  // Otherwise we keep the right side empty so the overview pane is the focus.
  useEffect(() => {
    const requestedId = searchParams.get("selected");
    if (!requestedId) return;
    const list =
      filter === "all"
        ? mergedSkills
        : mergedSkills?.filter((s) => installedAgents(s).includes(filter));
    if (!list?.length) return;

    const target = list.find((s) => s.id === requestedId);
    if (target) {
      setSelectedId(target.id);
      setSelectedSkill(target);
      setPanelMode("detail");
    }
  }, [mergedSkills, filter, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep selectedSkill in sync when underlying data refreshes (e.g. filesystem changes)
  useEffect(() => {
    if (selectedId && mergedSkills?.length) {
      const refreshed = mergedSkills.find((s) => s.id === selectedId);
      if (refreshed) {
        setSelectedSkill(refreshed);
      }
    }
  }, [mergedSkills, selectedId]);

  function changeFilter(f: string) {
    setFilter(f);
    if (f === "all") {
      setSearchParams({});
    } else {
      setSearchParams({ agent: f });
    }
    // Reset selection so the auto-select effect picks the first item in the new list
    setSelectedId(null);
    setSelectedSkill(null);
  }

  const selectSkill = useCallback((skill: Skill) => {
    // Instant: update list highlight
    setSelectedId(skill.id);
    setPanelMode("detail");
    // Deferred: update detail panel without blocking the list
    startTransition(() => {
      setSelectedSkill(skill);
    });
  }, []);

  function closePanel() {
    setSelectedId(null);
    setSelectedSkill(null);
    setPanelMode("detail");
  }

  const detectedAgents = agents?.filter((a) => a.detected) ?? [];

  // Per-agent skill count for filter chips (uses available = installed-or-inherited skills)
  const skillCountByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    const available = mergedSkills?.filter((s) => allAgents(s).length > 0) ?? [];
    for (const s of available) {
      for (const slug of allAgents(s)) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    return counts;
  }, [mergedSkills]);

  const totalAvailableCount = useMemo(
    () => mergedSkills?.filter((s) => allAgents(s).length > 0).length ?? 0,
    [mergedSkills],
  );

  // Stats for top cards
  const stats = useMemo(() => {
    const all = mergedSkills?.filter((s) => allAgents(s).length > 0) ?? [];
    const directlyInstalled = all.filter((s) => installedAgents(s).length > 0);
    const globalScope = all.filter((s) => s.scope.type === "SharedGlobal");
    const updatable = all.filter(
      (s) => getSourceKind(s.source) === "git" && installedAgents(s).length > 0,
    );
    return {
      total: all.length,
      installed: directlyInstalled.length,
      global: globalScope.length,
      updatable: updatable.length,
    };
  }, [mergedSkills]);

  // Stats scoped to the currently filtered agent (filter !== "all")
  const currentAgentStats = useMemo(() => {
    if (filter === "all") return null;
    const list = mergedSkills?.filter((s) => allAgents(s).includes(filter)) ?? [];
    let direct = 0;
    let inherited = 0;
    let updatable = 0;
    for (const s of list) {
      const isDirect = installedAgents(s).includes(filter);
      if (isDirect) direct += 1;
      else inherited += 1;
      if (isDirect && getSourceKind(s.source) === "git") updatable += 1;
    }
    return { total: list.length, direct, inherited, updatable };
  }, [mergedSkills, filter]);

  const currentAgent = useMemo(
    () => (filter === "all" ? null : detectedAgents.find((a) => a.slug === filter) ?? null),
    [detectedAgents, filter],
  );

  // Filter pipeline: agent → status → scope → source → search → sort
  const filtered = useMemo(() => {
    // Only show skills that have at least one installation (direct or inherited)
    const available = mergedSkills?.filter((s) => allAgents(s).length > 0) ?? [];
    let list: SkillWithRepo[] = filter === "all"
      ? available
      : available.filter((s) => allAgents(s).includes(filter));

    if (statusFilter === "installed") {
      list = list.filter((s) => installedAgents(s).length > 0);
    } else if (statusFilter === "inherited") {
      list = list.filter(
        (s) => installedAgents(s).length === 0 && allAgents(s).length > 0,
      );
    }

    if (scopeFilter === "global") {
      list = list.filter((s) => s.scope.type === "SharedGlobal");
    } else if (scopeFilter === "local") {
      list = list.filter((s) => s.scope.type !== "SharedGlobal");
    }

    if (sourceFilter !== "all") {
      list = list.filter((s) => getSourceKind(s.source) === sourceFilter);
    }

    // AND-semantics: skill must carry ALL selected tags.
    // Skill.tags are normalized at scan time so equality compare is safe.
    if (tagFilter.size > 0) {
      list = list.filter((s) => {
        const owned = new Set(s.tags ?? []);
        for (const t of tagFilter) {
          if (!owned.has(t)) return false;
        }
        return true;
      });
    }

    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          (s.description && s.description.toLowerCase().includes(q)),
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name) * dir);
    } else if (sortKey === "agents") {
      list = [...list].sort(
        (a, b) => (allAgents(a).length - allAgents(b).length) * dir,
      );
    }

    return list;
  }, [
    mergedSkills,
    filter,
    statusFilter,
    scopeFilter,
    sourceFilter,
    tagFilter,
    deferredSearch,
    sortKey,
    sortDir,
  ]);

  // Tag cloud source — scoped to the current agent so the cloud "follows"
  // the active filter. Counts let us sort by frequency and surface the
  // most useful tags first.
  //
  // Each skill's tag list is deduped per-skill before counting so that a
  // malformed override (extremely rare; backend normalize should prevent it)
  // cannot inflate a skill's contribution to the count.
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    const pool: SkillWithRepo[] = (mergedSkills ?? []).filter((s) =>
      filter === "all" ? true : allAgents(s).includes(filter),
    );
    for (const s of pool) {
      const seen = new Set<string>();
      for (const t of s.tags ?? []) {
        if (seen.has(t)) continue;
        seen.add(t);
        map.set(t, (map.get(t) ?? 0) + 1);
      }
    }
    return map;
  }, [mergedSkills, filter]);

  // Sorted [tag, count] entries, desc by count then alpha. Used by OverviewPane.
  const sortedTags = useMemo(() => {
    return Array.from(tagCounts.entries()).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
  }, [tagCounts]);

  function toggleTag(tag: string) {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function clearTagFilter() {
    setTagFilter(new Set());
  }

  // === Batch AI tag generation ===
  // Walks every skill in the *current agent scope* whose effective tag list
  // is empty, asks the AI for 3-5 candidates per skill, and writes them as
  // overrides. Runs with bounded concurrency so we don't burst the provider
  // (and so users see steady progress instead of a long silent wait).
  //
  // Cost note: each item is one chat-completions call (~hundreds of tokens
  // in/out). We confirm before starting so users know what they're paying.
  const aiCfg = useAIConfig();
  const aiBatchReady = !!aiCfg.data && aiCfg.data.enabled && aiCfg.data.has_api_key;
  const untaggedInScope = useMemo(() => {
    const pool: SkillWithRepo[] = (mergedSkills ?? []).filter((s) =>
      filter === "all" ? true : allAgents(s).includes(filter),
    );
    return pool.filter((s) => (s.tags ?? []).length === 0);
  }, [mergedSkills, filter]);

  const [batchTagState, setBatchTagState] = useState<{
    running: boolean;
    done: number;
    total: number;
    errors: number;
  }>({ running: false, done: 0, total: 0, errors: 0 });

  // User-tunable batch concurrency. Default 1 = safest for free-tier
  // providers (most cap at 2 QPS); power users with paid quota can bump
  // it from the confirm dialog. Persisted to localStorage so the choice
  // sticks across sessions.
  const [batchConcurrency, setBatchConcurrency] = useState<1 | 2 | 3>(() => {
    if (typeof window === "undefined") return 1;
    const raw = window.localStorage.getItem("ai-tags-batch-concurrency");
    const n = raw ? Number(raw) : 1;
    return n === 2 || n === 3 ? (n as 2 | 3) : 1;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("ai-tags-batch-concurrency", String(batchConcurrency));
  }, [batchConcurrency]);

  // Cancellation token for in-flight batch. Bumped by abort() so workers
  // can exit cleanly mid-loop.
  const batchAbortRef = useRef({ cancelled: false });

  const handleBatchAITags = useCallback(async () => {
    const targets = untaggedInScope;
    if (targets.length === 0 || batchTagState.running) return;

    // Per-request pacing — keeps free-tier providers (typically 2 QPS)
    // happy. With CONCURRENCY=1 the effective rate is 1 / (avgLatency +
    // PACING_MS); with higher concurrency we still space launches.
    const PACING_MS = 600;
    // Estimate runtime so users know what they're signing up for. Real
    // per-call latency varies wildly with provider, so this is a hint
    // not a contract.
    const PER_CALL_ESTIMATE_MS = 1200;
    const estimatedSec = Math.ceil(
      (targets.length * (PER_CALL_ESTIMATE_MS + PACING_MS)) / batchConcurrency / 1000,
    );

    const ok = window.confirm(
      t("skills.aiTagsBatchConfirm", {
        count: targets.length,
        concurrency: batchConcurrency,
        seconds: estimatedSec,
      }),
    );
    if (!ok) return;

    // Snapshot the count so the progress UI doesn't flicker if the underlying
    // list changes mid-flight (e.g. user toggles filters).
    const total = targets.length;
    batchAbortRef.current = { cancelled: false };
    setBatchTagState({ running: true, done: 0, total, errors: 0 });

    let cursor = 0;
    let done = 0;
    let errors = 0;
    let lastLaunchAt = 0;

    // Stagger worker launches by PACING_MS so we don't burst the provider
    // when CONCURRENCY > 1. Each worker also pauses PACING_MS after a
    // successful call, naturally throttling steady-state QPS.
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    async function pacedDelay() {
      const elapsed = Date.now() - lastLaunchAt;
      if (elapsed < PACING_MS) {
        await sleep(PACING_MS - elapsed);
      }
      lastLaunchAt = Date.now();
    }

    async function callWithRetry(sk: SkillWithRepo): Promise<void> {
      // Single retry with backoff for HTTP 429 / network errors. We don't
      // retry forever — a flaky run is still progress; the user can re-run
      // batch on the remaining N afterwards.
      const MAX_ATTEMPTS = 2;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const resp = await invoke<{ tags: string[] }>(
            "ai_suggest_skill_tags",
            {
              skillName: sk.name,
              description: sk.description ?? null,
              existingTags: sk.tags ?? [],
            },
          );
          if (resp.tags && resp.tags.length > 0) {
            await invoke<string[]>("set_skill_tags", {
              skillId: sk.id,
              tags: resp.tags,
            });
          }
          return;
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          // 429 / quota / network — exponential-ish backoff (1.5s, 3s)
          // before retry. Other errors fail-fast (no point retrying a
          // malformed prompt).
          const retryable =
            msg.includes("429") ||
            msg.toLowerCase().includes("rate") ||
            msg.toLowerCase().includes("quota") ||
            msg.toLowerCase().includes("timeout") ||
            msg.toLowerCase().includes("network");
          if (attempt < MAX_ATTEMPTS && retryable) {
            await sleep(1500 * attempt);
            continue;
          }
          throw lastErr;
        }
      }
    }

    async function worker() {
      while (true) {
        if (batchAbortRef.current.cancelled) return;
        const i = cursor++;
        if (i >= total) return;
        const sk = targets[i];
        await pacedDelay();
        try {
          await callWithRetry(sk);
        } catch {
          errors++;
        } finally {
          done++;
          setBatchTagState({ running: true, done, total, errors });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(batchConcurrency, total) }, worker),
    );

    const wasCancelled = batchAbortRef.current.cancelled;
    setBatchTagState({ running: false, done, total, errors });
    // Single bulk invalidate at the end — beats N round-trips during the loop.
    queryClient.invalidateQueries({ queryKey: ["skill-tag-overrides"] });
    queryClient.invalidateQueries({ queryKey: ["skills"] });
    toast(
      wasCancelled
        ? t("skills.aiTagsBatchCancelled", { done, total })
        : t("skills.aiTagsBatchDone", { done, errors }),
      errors > 0 && !wasCancelled ? "destructive" : "default",
    );
  }, [untaggedInScope, batchTagState.running, batchConcurrency, queryClient, t, toast]);

  // Cancel handler — workers check the flag on their next loop turn.
  const handleCancelBatchAITags = useCallback(() => {
    batchAbortRef.current.cancelled = true;
  }, []);

  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (filter !== "all") n++;
    if (statusFilter !== "all") n++;
    if (scopeFilter !== "all") n++;
    if (sourceFilter !== "all") n++;
    if (tagFilter.size > 0) n++;
    if (deferredSearch.trim()) n++;
    return n;
  }, [filter, statusFilter, scopeFilter, sourceFilter, tagFilter, deferredSearch]);

  function clearAllFilters() {
    setFilter("all");
    setStatusFilter("all");
    setScopeFilter("all");
    setSourceFilter("all");
    setTagFilter(new Set());
    setSearchQuery("");
    setSearchParams({});
  }

  // Skills managed by a collection (parent + children) — read-only, no sync/uninstall
  const collectionSkillIds = useMemo(() => {
    const ids = new Set<string>();
    const collectionNames = new Set<string>();
    for (const s of mergedSkills ?? []) {
      if (s.collection) {
        ids.add(s.id);
        collectionNames.add(s.collection);
      }
    }
    // Also mark the parent skill
    for (const s of mergedSkills ?? []) {
      if (collectionNames.has(s.id)) ids.add(s.id);
    }
    return ids;
  }, [mergedSkills]);

  async function refreshAndReselect() {
    // Force a fresh scan, bypassing cache
    const updated = await queryClient.fetchQuery<Skill[]>({
      queryKey: ["skills"],
      queryFn: () => invoke("scan_all_skills"),
      staleTime: 0,
    });
    // Also invalidate so other components pick up the change
    queryClient.setQueryData(["skills"], updated);
    if (selectedId) {
      const refreshed = updated?.find((s) => s.id === selectedId);
      setSelectedSkill(refreshed ?? null);
      if (!refreshed) setSelectedId(null);
    }
  }

  async function handleUninstall(skillId: string, agentSlug: string) {
    const k = busyKey(skillId, agentSlug);
    setBusyAgents((prev) => new Map(prev).set(k, "uninstalling"));
    try {
      await invoke("uninstall_skill", { skillId, agentSlug });
      await refreshAndReselect();
    } catch (e) {
      console.error("Uninstall failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.uninstallFailed"), "destructive");
    } finally {
      setBusyAgents((prev) => { const next = new Map(prev); next.delete(k); return next; });
    }
  }

  async function handleUninstallAll(skill: Skill) {
    const slugs = installedAgents(skill);
    if (!slugs.length) return;
    setBusyAgents((prev) => {
      const next = new Map(prev);
      slugs.forEach((s) => next.set(busyKey(skill.id, s), "uninstalling"));
      return next;
    });
    try {
      await invoke("uninstall_skill_all", { skillId: skill.id });
      setSelectedId(null);
      setSelectedSkill(null);
      await refreshAndReselect();
    } catch (e) {
      console.error("Uninstall all failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.uninstallFailed"), "destructive");
    } finally {
      setBusyAgents(new Map());
    }
  }

  async function handleSync(skillId: string, targetAgents: string[]) {
    setBusyAgents((prev) => {
      const next = new Map(prev);
      targetAgents.forEach((a) => next.set(busyKey(skillId, a), "syncing"));
      return next;
    });
    try {
      await invoke("sync_skill", { skillId, targetAgents });
      await refreshAndReselect();
    } catch (e) {
      console.error("Sync failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.syncFailed"), "destructive");
    } finally {
      setBusyAgents((prev) => {
        const next = new Map(prev);
        targetAgents.forEach((a) => next.delete(busyKey(skillId, a)));
        return next;
      });
    }
  }

  const [updating, setUpdating] = useState(false);

  async function handleUpdate(skillId: string) {
    setUpdating(true);
    try {
      await invoke("update_skill", { skillId });
      await refreshAndReselect();
      toast(t("skills.updateSuccess"));
    } catch (e) {
      console.error("Update failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.updateFailed"), "destructive");
    } finally {
      setUpdating(false);
    }
  }

  // ─── Update All ───
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updateAllProgress, setUpdateAllProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ done: number; total: number; current_skill: string }>(
      "skill-update-progress",
      (event) => {
        setUpdateAllProgress({ done: event.payload.done, total: event.payload.total });
      },
    ).then((cleanup) => { unlisten = cleanup; });
    return () => { unlisten?.(); };
  }, []);

  async function handleUpdateAll() {
    setUpdatingAll(true);
    setUpdateAllProgress(null);
    try {
      const result = await invoke<{ updated: string[]; failed: [string, string][]; skipped: number }>(
        "update_all_skills",
      );
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
      await refreshAndReselect();

      if (result.failed.length === 0 && result.updated.length > 0) {
        toast(t("skills.updateAllDone", { updated: result.updated.length }));
      } else if (result.updated.length > 0) {
        toast(t("skills.updateAllPartial", { updated: result.updated.length, failed: result.failed.length }), "destructive");
      } else if (result.failed.length > 0) {
        toast(t("skills.updateAllFailed"), "destructive");
      }
    } catch (e) {
      console.error("Update all failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.updateAllFailed"), "destructive");
    } finally {
      setUpdatingAll(false);
      setUpdateAllProgress(null);
    }
  }

  // ─── Bulk Selection ───
  function exitBulkMode() {
    setBulkMode(false);
    setSelectedIds(new Set());
  }
  function toggleBulkMode() {
    setBulkMode((prev) => {
      const next = !prev;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  }
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  function bulkSelectAll() {
    const eligible = (filtered ?? [])
      .filter((s) => !collectionSkillIds.has(s.id))
      .map((s) => s.id);
    setSelectedIds(new Set(eligible));
  }
  function bulkClear() {
    setSelectedIds(new Set());
  }

  // ─── Bulk: Uninstall ───
  const [bulkRunning, setBulkRunning] = useState(false);
  async function handleBulkUninstall() {
    if (selectedIds.size === 0) return;
    const ok = window.confirm(
      `${t("skills.bulkConfirmUninstall", { count: selectedIds.size })}\n${t("skills.bulkConfirmUninstallDesc")}`,
    );
    if (!ok) return;
    setBulkRunning(true);
    let success = 0;
    for (const id of Array.from(selectedIds)) {
      try {
        await invoke("uninstall_skill_all", { skillId: id });
        success += 1;
      } catch (e) {
        console.error("Bulk uninstall failed for", id, e);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await refreshAndReselect();
    setSelectedIds(new Set());
    setBulkRunning(false);
    toast(t("skills.bulkUninstallSuccess", { count: success }));
  }

  // ─── Bulk: Update ───
  async function handleBulkUpdate() {
    if (selectedIds.size === 0) return;
    setBulkRunning(true);
    let updated = 0;
    let failed = 0;
    for (const id of Array.from(selectedIds)) {
      try {
        await invoke("update_skill", { skillId: id });
        updated += 1;
      } catch {
        failed += 1;
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await refreshAndReselect();
    setBulkRunning(false);
    toast(t("skills.bulkUpdateSuccess", { updated, failed }), failed > 0 ? "destructive" : "default");
  }

  // ─── Bulk: Sync to agents ───
  const [bulkSyncDialog, setBulkSyncDialog] = useState(false);
  async function handleBulkSync(targetAgents: string[]) {
    if (selectedIds.size === 0 || targetAgents.length === 0) return;
    setBulkRunning(true);
    let ok = 0;
    const total = selectedIds.size;
    for (const id of Array.from(selectedIds)) {
      try {
        await invoke("sync_skill", { skillId: id, targetAgents });
        ok += 1;
      } catch (e) {
        console.error("Bulk sync failed for", id, e);
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await refreshAndReselect();
    setBulkRunning(false);
    setBulkSyncDialog(false);
    toast(t("skills.bulkSyncSuccess", { ok, total }), ok < total ? "destructive" : "default");
  }

  // ─── Phase 4: Keyboard navigation & shortcuts ───
  // Build flat list of selectable skills for nav (in display order)
  const navList = filtered ?? [];
  useEffect(() => {
    function isInputFocused() {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || el.isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      // Don't interfere with modal/editor or input focus
      if (panelMode === "editor") return;
      if (isInputFocused()) return;
      if (bulkSyncDialog) return;

      if (e.key === "Escape") {
        if (bulkMode) {
          exitBulkMode();
          e.preventDefault();
        } else if (selectedId) {
          closePanel();
          e.preventDefault();
        }
        return;
      }
      if (!navList.length) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const currentIdx = selectedId ? navList.findIndex((s) => s.id === selectedId) : -1;
        const nextIdx =
          e.key === "ArrowDown"
            ? Math.min(currentIdx + 1, navList.length - 1)
            : Math.max(currentIdx - 1, 0);
        const target = navList[nextIdx >= 0 ? nextIdx : 0];
        if (target) selectSkill(target);
        return;
      }
      if (e.key === "Enter") {
        const target = selectedId ? navList.find((s) => s.id === selectedId) : navList[0];
        if (target) {
          selectSkill(target);
          e.preventDefault();
        }
        return;
      }
      // Cmd/Ctrl + E => edit
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        if (selectedSkill && !collectionSkillIds.has(selectedSkill.id)) {
          setPanelMode("editor");
          e.preventDefault();
        }
        return;
      }
      // Cmd/Ctrl + R => update from source
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        if (selectedSkill && getSourceRepo(selectedSkill.source)) {
          handleUpdate(selectedSkill.id);
          e.preventDefault();
        }
        return;
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navList, selectedId, selectedSkill, panelMode, bulkMode, bulkSyncDialog]);

  const hasNoSkillsAtAll = !isLoading && (mergedSkills?.length ?? 0) === 0;
  const filteredCount = filtered?.length ?? 0;

  // Scroll-to-top floating button — visible after scrolling past 240px
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 240);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const scrollListToTop = useCallback(() => {
    listScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* === Page header bar (full-width, above overview) === */}
      <div className="shrink-0 px-4 pt-3 pb-1 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Puzzle className="size-4 shrink-0 text-primary/80" />
            <h1 className="text-[15px] font-semibold leading-none truncate">{t("skills.title")}</h1>
          </div>
          {mergedSkills && !hasNoSkillsAtAll && (
            <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
              {t("skills.headerSubtitle", {
                total: stats.total,
                installed: stats.installed,
                filtered: filteredCount,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant={bulkMode ? "default" : "ghost"}
            size="icon-sm"
            title={bulkMode ? t("skills.bulkExit") : t("skills.bulkMode")}
            onClick={toggleBulkMode}
            disabled={isLoading || hasNoSkillsAtAll}
          >
            <ListChecks className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size={updatingAll ? "sm" : "icon-sm"}
            className={updatingAll ? "gap-1.5 text-xs" : ""}
            title={t("skills.updateAll")}
            disabled={updatingAll || isLoading}
            onClick={handleUpdateAll}
          >
            <RefreshCw className={`size-3.5 ${updatingAll ? "animate-spin" : ""}`} />
            {updatingAll && (
              <span>
                {updateAllProgress
                  ? t("skills.updateAllProgress", { done: updateAllProgress.done, total: updateAllProgress.total })
                  : t("skills.updating")}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* === TOP: full-width Overview pane.
          Scrolling lives on the OUTER wrapper (not inside the glass panel) so:
            - content that fits → no scrollbar at all
            - content that overflows max-h-[55vh] → a single, page-edge scrollbar,
              never an ugly inner one chopping the panel in half. */}
      <div
        className="shrink-0 min-w-0 px-2 pt-2 pb-2 flex flex-col max-h-[55vh] overflow-x-hidden overflow-y-auto overscroll-contain"
        style={{ minHeight: topPane.height }}
      >
        <OverviewPane
          filter={filter}
          currentAgent={currentAgent}
          currentAgentStats={currentAgentStats}
          stats={stats}
          statusFilter={statusFilter}
          scopeFilter={scopeFilter}
          sourceFilter={sourceFilter}
          setStatusFilter={setStatusFilter}
          setScopeFilter={setScopeFilter}
          setSourceFilter={setSourceFilter}
          tagFilter={tagFilter}
          sortedTags={sortedTags}
          onToggleTag={toggleTag}
          onClearTagFilter={clearTagFilter}
          batchAITagsCount={untaggedInScope.length}
          batchAITagsReady={aiBatchReady}
          batchAITagsState={batchTagState}
          batchConcurrency={batchConcurrency}
          onBatchConcurrencyChange={setBatchConcurrency}
          onBatchAITags={handleBatchAITags}
          onCancelBatchAITags={handleCancelBatchAITags}
          compact={topPane.height < 230}
          onChangeFilter={changeFilter}
          detectedAgents={detectedAgents}
          fullHeight
          agentFilterPills={
            detectedAgents.length > 0 && !hasNoSkillsAtAll ? (
              <div className="flex gap-1 flex-wrap">
                <FilterPill
                  active={filter === "all"}
                  onClick={() => changeFilter("all")}
                  label={t("skills.filterAll")}
                  count={totalAvailableCount}
                />
                {detectedAgents.map((agent) => {
                  const count = skillCountByAgent.get(agent.slug) ?? 0;
                  const isActive = filter === agent.slug;
                  return (
                    <FilterPill
                      key={agent.slug}
                      active={isActive}
                      onClick={() => changeFilter(agent.slug)}
                      label={agent.name}
                      count={count}
                      icon={<FilterAgentIcon slug={agent.slug} />}
                    />
                  );
                })}
              </div>
            ) : null
          }
          aiSearchSlot={!hasNoSkillsAtAll ? <AISearchBar /> : null}
        />
      </div>

      {/* Vertical resize handle between top overview and bottom split */}
      <ResizeHandle direction="vertical" onMouseDown={topPane.onMouseDown} />

      {/* === BOTTOM: list pane (left) + detail pane (right) === */}
      <div className="flex-1 flex min-h-0">
      {/* Main list (left) */}
      <div
        ref={listScrollRef}
        className="shrink-0 overflow-y-auto overflow-x-hidden p-4 space-y-3 relative"
        style={{ width: listPane.width }}
      >
        {/* === Advanced filter toggle + Sort === */}
        {!hasNoSkillsAtAll && (
          <div className="flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((p) => !p)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                showAdvancedFilters || activeFiltersCount > 0
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-black/4 dark:hover:bg-white/4",
              )}
              title={t("skills.activeFilters", { count: activeFiltersCount })}
            >
              <ChevronRight className={cn("size-3 transition-transform", showAdvancedFilters && "rotate-90")} />
              <span>{t("skills.filterByStatus")}</span>
              {activeFiltersCount > 0 && (
                <span className="rounded-full bg-primary text-primary-foreground px-1.5 py-px text-[9px] font-bold tabular-nums leading-none">
                  {activeFiltersCount}
                </span>
              )}
            </button>
            <SortControl
              sortKey={sortKey}
              sortDir={sortDir}
              onChangeKey={setSortKey}
              onToggleDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            />
          </div>
        )}

        {/* === Advanced filters (expanded) === */}
        {showAdvancedFilters && !hasNoSkillsAtAll && (
          <div className="rounded-xl border border-black/6 dark:border-white/6 p-2.5 space-y-2 bg-black/2 dark:bg-white/2">
            <FilterRow
              label={t("skills.filterByStatus")}
              value={statusFilter}
              options={[
                { id: "all", label: t("skills.statusAll") },
                { id: "installed", label: t("skills.statusInstalled") },
                { id: "inherited", label: t("skills.statusInheritedOnly") },
              ]}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
            />
            <FilterRow
              label={t("skills.filterByScope")}
              value={scopeFilter}
              options={[
                { id: "all", label: t("skills.scopeAll") },
                { id: "global", label: t("skills.scopeOnlyGlobal") },
                { id: "local", label: t("skills.scopeOnlyLocal") },
              ]}
              onChange={(v) => setScopeFilter(v as ScopeFilter)}
            />
            <FilterRow
              label={t("skills.filterBySource")}
              value={sourceFilter}
              options={[
                { id: "all", label: t("skills.sourceFilterAll") },
                { id: "local", label: t("skills.sourceFilterLocal") },
                { id: "git", label: t("skills.sourceFilterGit") },
                { id: "market", label: t("skills.sourceFilterMarket") },
                { id: "unknown", label: t("skills.sourceFilterUnknown") },
              ]}
              onChange={(v) => setSourceFilter(v as SourceFilter)}
            />
            {activeFiltersCount > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <X className="size-3" />
                  {t("skills.clearFilters")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        {!hasNoSkillsAtAll && (
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t("skills.filterPlaceholder")}
            debounce={0}
            count={
              mergedSkills && (searchQuery || activeFiltersCount > 0 || filter !== "all")
                ? { current: filteredCount, total: stats.total }
                : null
            }
          />
        )}

        {/* Bulk action bar (only when bulk mode + selected) */}
        {bulkMode && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            running={bulkRunning}
            onSelectAll={bulkSelectAll}
            onClear={bulkClear}
            onSync={() => setBulkSyncDialog(true)}
            onUpdate={handleBulkUpdate}
            onUninstall={handleBulkUninstall}
          />
        )}

        {/* Skill list */}
        {isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl px-3 py-2.5 space-y-2 bg-black/2 dark:bg-white/2"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="h-3.5 w-28 rounded-md animate-skeleton" />
                <div className="h-3 w-40 rounded-md animate-skeleton" />
                <div className="flex gap-1 pt-0.5">
                  <div className="size-4 rounded-full animate-skeleton" />
                  <div className="size-4 rounded-full animate-skeleton" />
                </div>
              </div>
            ))}
          </div>
        ) : hasNoSkillsAtAll ? (
          <EmptyStateNoSkills />
        ) : !filtered?.length ? (
          <EmptyStateNoResults onClear={clearAllFilters} />
        ) : (
          <SkillListGrouped
            skills={filtered}
            selectedId={selectedId}
            agents={agents}
            onSelect={selectSkill}
            onReveal={revealItemInDir}
            onUninstallAll={handleUninstallAll}
            isSearchStale={isSearchStale}
            bulkMode={bulkMode}
            selectedIds={selectedIds}
            collectionSkillIds={collectionSkillIds}
            onToggleSelect={toggleSelected}
          />
        )}

        {/* Keyboard hint footer */}
        {!isLoading && !hasNoSkillsAtAll && (filtered?.length ?? 0) > 0 && (
          <p className="text-[10px] text-muted-foreground/40 text-center pt-1 select-none hidden md:block">
            {t("skills.keyboardHint")}
          </p>
        )}

        {/* Scroll-to-top floating button */}
        <button
          type="button"
          onClick={scrollListToTop}
          aria-label={t("skills.scrollToTop")}
          title={t("skills.scrollToTop")}
          className={cn(
            "sticky bottom-3 ml-auto flex size-8 items-center justify-center rounded-full glass-elevated text-foreground shadow-lg transition-all duration-200 hover:scale-110 hover:text-primary",
            showScrollTop
              ? "opacity-100 translate-y-0 pointer-events-auto"
              : "opacity-0 translate-y-2 pointer-events-none",
          )}
        >
          <ChevronUp className="size-4" />
        </button>
      </div>

      <ResizeHandle onMouseDown={listPane.onMouseDown} />

      {/* === Right side: Detail pane (or Editor) === */}
      {selectedSkill && panelMode === "editor" ? (
        <SkillEditor
          skill={selectedSkill}
          onClose={closePanel}
          onBack={() => setPanelMode("detail")}
        />
      ) : (
        // Wrapper owns scrolling — moving overflow-y-auto here (instead of
        // inside SkillDetail) means a wheel event anywhere over the right
        // pane (including the 8px margin) scrolls the detail. Users no
        // longer need to "focus" the body first. overscroll-contain prevents
        // bouncing the parent scroll context.
        <div className="flex-1 min-w-0 m-2 ml-0 min-h-0 overflow-y-auto overscroll-contain">
          {selectedId && panelMode === "detail" ? (
            isPending || !selectedSkill ? (
              <div className="min-h-full rounded-2xl glass-panel flex items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <SkillDetail
                skill={selectedSkill}
                detectedAgents={detectedAgents}
                busyAgents={busyAgents}
                updating={updating}
                readOnly={collectionSkillIds.has(selectedSkill.id)}
                breadcrumb={[
                  { label: t("skills.title"), onClick: filter !== "all" ? () => changeFilter("all") : undefined },
                  ...(filter !== "all" && currentAgent
                    ? [{ label: currentAgent.name }]
                    : []),
                  { label: selectedSkill.name },
                ]}
                onClose={closePanel}
                onEdit={() => setPanelMode("editor")}
                onSync={handleSync}
                onUpdate={handleUpdate}
                onUninstall={handleUninstall}
                onUninstallAll={handleUninstallAll}
              />
            )
          ) : (
            <EmptyDetailPane
              hasResults={!!filtered && filtered.length > 0}
              hasAnySkills={(mergedSkills?.length ?? 0) > 0}
            />
          )}
        </div>
      )}
      </div>{/* end bottom row (list + detail) */}

      {/* Bulk Sync Dialog */}
      {bulkSyncDialog && (
        <BulkSyncDialog
          count={selectedIds.size}
          detectedAgents={detectedAgents}
          running={bulkRunning}
          onClose={() => setBulkSyncDialog(false)}
          onConfirm={handleBulkSync}
        />
      )}
    </div>
  );
}

function SkillListGrouped({
  skills,
  selectedId,
  agents,
  onSelect,
  onReveal,
  onUninstallAll,
  isSearchStale,
  bulkMode = false,
  selectedIds,
  collectionSkillIds,
  onToggleSelect,
}: {
  skills: SkillWithRepo[];
  selectedId: string | null;
  agents: import("@/hooks/useAgents").AgentConfig[] | undefined;
  onSelect: (skill: SkillWithRepo) => void;
  onReveal: (path: string) => void;
  onUninstallAll: (skill: SkillWithRepo) => void;
  isSearchStale: boolean;
  bulkMode?: boolean;
  selectedIds?: Set<string>;
  collectionSkillIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Group skills: collection skills grouped under their parent, standalone skills as-is
  const groups = useMemo(() => {
    // Collect child skills by collection name
    const children = new Map<string, SkillWithRepo[]>();
    for (const skill of skills) {
      if (skill.collection) {
        const list = children.get(skill.collection) ?? [];
        list.push(skill);
        children.set(skill.collection, list);
      }
    }
    // Find collection names that have children
    const collectionNames = new Set(children.keys());

    type Group =
      | { type: "standalone"; skill: SkillWithRepo }
      | { type: "collection"; parent: SkillWithRepo; children: SkillWithRepo[] };
    const result: Group[] = [];
    for (const skill of skills) {
      if (skill.collection) {
        // Skip child skills — they're nested under the parent
        continue;
      }
      if (collectionNames.has(skill.id)) {
        // This skill is the parent of a collection
        result.push({ type: "collection", parent: skill, children: children.get(skill.id)! });
      } else {
        result.push({ type: "standalone", skill });
      }
    }
    return result;
  }, [skills]);

  const toggle = (name: string) =>
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <div
      className="space-y-1 transition-opacity"
      style={{ opacity: isSearchStale ? 0.5 : 1 }}
    >
      {groups.map((group) => {
        if (group.type === "standalone") {
          const id = group.skill.id;
          const isCollectionChild = collectionSkillIds?.has(id) ?? false;
          return (
            <SkillListItem
              key={id}
              skill={group.skill}
              selected={selectedId === id}
              agents={agents}
              onSelect={onSelect}
              onReveal={onReveal}
              onUninstallAll={onUninstallAll}
              bulkMode={bulkMode}
              bulkSelected={selectedIds?.has(id) ?? false}
              bulkDisabled={isCollectionChild}
              onToggleSelect={onToggleSelect}
            />
          );
        }
        const isCollapsed = collapsed[group.parent.id] ?? true;
        return (
          <div key={`collection-${group.parent.id}`}>
            <CollectionItem
              parent={group.parent}
              childCount={group.children.length}
              selected={selectedId === group.parent.id}
              collapsed={isCollapsed}
              agents={agents}
              onSelect={onSelect}
              onReveal={onReveal}
              onToggle={() => toggle(group.parent.id)}
              bulkMode={bulkMode}
            />
            {!isCollapsed && (
              <div className="ml-3 border-l border-black/6 dark:border-white/6 pl-1">
                {group.children.map((skill) => (
                  <SkillListItem
                    key={skill.id}
                    skill={skill}
                    selected={selectedId === skill.id}
                    agents={agents}
                    onSelect={onSelect}
                    onReveal={onReveal}
                    onUninstallAll={onUninstallAll}
                    disableContextMenu
                    bulkMode={bulkMode}
                    bulkSelected={false}
                    bulkDisabled
                    onToggleSelect={onToggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CollectionItem = memo(function CollectionItem({
  parent,
  childCount,
  selected,
  collapsed,
  agents,
  onSelect,
  onReveal,
  onToggle,
  bulkMode = false,
}: {
  parent: SkillWithRepo;
  childCount: number;
  selected: boolean;
  collapsed: boolean;
  agents: import("@/hooks/useAgents").AgentConfig[] | undefined;
  onSelect: (skill: SkillWithRepo) => void;
  onReveal: (path: string) => void;
  onToggle: () => void;
  bulkMode?: boolean;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const directSlugs = installedAgents(parent);
  const inheritedSlugs = parent.installations
    .filter((i) => i.is_inherited)
    .map((i) => i.agent_slug)
    .filter((s) => !directSlugs.includes(s));

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const raf = requestAnimationFrame(() => {
      document.addEventListener("click", close);
      document.addEventListener("contextmenu", close);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  return (
    <div className="relative">
      <div
        className={cn(
          "rounded-xl transition-all duration-200 select-none",
          selected
            ? "glass glass-shine-always"
            : "border border-transparent hover:bg-black/3 dark:hover:bg-white/4",
        )}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex items-start gap-2 px-3 py-2.5">
          {bulkMode && (
            <div
              className="size-4 mt-0.5 rounded border border-muted-foreground/40 shrink-0 flex items-center justify-center bg-muted/30"
              title="集合不参与批量"
            >
              <X className="size-2.5 text-muted-foreground/40" />
            </div>
          )}
          <button
            type="button"
            className="w-full text-left min-w-0"
            onClick={() => { onSelect(parent); if (collapsed) onToggle(); }}
          >
            <div className="flex items-center gap-2">
              <Package className="size-3.5 text-primary/70 shrink-0" />
              <h3 className="text-sm font-medium truncate">{parent.name}</h3>
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {childCount}
              </span>
              <button
                type="button"
                className="shrink-0 ml-auto p-0.5 rounded hover:bg-black/6 dark:hover:bg-white/8 transition-colors"
                onClick={(e) => { e.stopPropagation(); onToggle(); }}
                title={collapsed ? "展开" : "折叠"}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 text-muted-foreground transition-transform duration-200",
                    !collapsed && "rotate-90",
                  )}
                />
              </button>
            </div>
            {parent.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {parent.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {directSlugs.map((slug) => (
                <span
                  key={slug}
                  className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-medium"
                  title={agents?.find((a) => a.slug === slug)?.name ?? slug}
                >
                  <MiniAgentIcon slug={slug} />
                </span>
              ))}
              {inheritedSlugs.map((slug) => (
                <span
                  key={slug}
                  className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title={`${agents?.find((a) => a.slug === slug)?.name ?? slug} (继承)`}
                >
                  <MiniAgentIcon slug={slug} dimmed />
                </span>
              ))}
            </div>
          </button>
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-50 w-[180px] rounded-xl glass-elevated p-1 shadow-lg animate-fade-in-up"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/6 transition-colors"
            onClick={() => {
              onReveal(parent.canonical_path);
              setMenu(null);
            }}
          >
            {t("skills.revealInFinder")}
          </button>
          <button
            className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg text-destructive/40 cursor-not-allowed"
            disabled
          >
            {t("skills.uninstallAll")}
          </button>
        </div>
      )}
    </div>
  );
});

const SkillListItem = memo(function SkillListItem({
  skill,
  selected,
  agents,
  onSelect,
  onReveal,
  onUninstallAll,
  disableContextMenu = false,
  bulkMode = false,
  bulkSelected = false,
  bulkDisabled = false,
  onToggleSelect,
}: {
  skill: SkillWithRepo;
  selected: boolean;
  agents: import("@/hooks/useAgents").AgentConfig[] | undefined;
  onSelect: (skill: SkillWithRepo) => void;
  onReveal: (path: string) => void;
  onUninstallAll: (skill: SkillWithRepo) => void;
  disableContextMenu?: boolean;
  bulkMode?: boolean;
  bulkSelected?: boolean;
  bulkDisabled?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const directSlugs = installedAgents(skill);
  const inheritedSlugs = skill.installations
    .filter((i) => i.is_inherited)
    .map((i) => i.agent_slug)
    .filter((s) => !directSlugs.includes(s));
  const hasDirectInstall = directSlugs.length > 0;
  const inheritedOnly = !hasDirectInstall && inheritedSlugs.length > 0;
  const sourceKind = getSourceKind(skill.source);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const raf = requestAnimationFrame(() => {
      document.addEventListener("click", close);
      document.addEventListener("contextmenu", close);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  const handleClick = () => {
    if (bulkMode) {
      if (!bulkDisabled && onToggleSelect) onToggleSelect(skill.id);
      return;
    }
    onSelect(skill);
  };

  return (
    <div className="relative group">
      {/* Selection indicator bar (left edge) */}
      {selected && !bulkMode && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-0.5 rounded-r bg-primary animate-fade-in"
        />
      )}
      <button
        type="button"
        className={cn(
          "w-full rounded-xl text-left transition-all duration-200 select-none",
          selected && !bulkMode
            ? "glass glass-shine-always"
            : bulkSelected
              ? "bg-primary/8 ring-1 ring-primary/30"
              : "border border-transparent hover:bg-primary/4 hover:ring-1 hover:ring-primary/15 dark:hover:bg-white/4",
          inheritedOnly && !bulkSelected && "opacity-60",
          bulkDisabled && "opacity-40 cursor-not-allowed",
        )}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!disableContextMenu && !bulkMode) setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="flex items-start gap-2 px-3 py-2.5">
          {bulkMode && (
            <div
              className={cn(
                "size-4 mt-0.5 rounded shrink-0 flex items-center justify-center transition-colors",
                bulkDisabled
                  ? "border border-muted-foreground/20 bg-muted/30"
                  : bulkSelected
                    ? "bg-primary text-primary-foreground"
                    : "border border-muted-foreground/40 hover:border-primary/60",
              )}
            >
              {bulkSelected ? (
                <CheckSquare className="size-3" />
              ) : bulkDisabled ? (
                <X className="size-2.5 text-muted-foreground/40" />
              ) : null}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <h3 className="text-sm font-medium truncate">{skill.name}</h3>
              {sourceKind === "git" && (
                <GitBranch className="size-3 text-blue-500/70 shrink-0" />
              )}
              {sourceKind === "market" && (
                <Store className="size-3 text-violet-500/70 shrink-0" />
              )}
              {skill.scope.type === "SharedGlobal" && (
                <Globe className="size-3 text-emerald-500/70 shrink-0" />
              )}
            </div>
            {skill.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {skill.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {directSlugs.map((slug) => (
                <span
                  key={slug}
                  className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-medium"
                  title={agents?.find((a) => a.slug === slug)?.name ?? slug}
                >
                  <MiniAgentIcon slug={slug} />
                </span>
              ))}
              {inheritedSlugs.map((slug) => (
                <span
                  key={slug}
                  className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-muted-foreground/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title={`${agents?.find((a) => a.slug === slug)?.name ?? slug} (继承)`}
                >
                  <MiniAgentIcon slug={slug} dimmed />
                </span>
              ))}
            </div>
          </div>
        </div>
      </button>

      {/* Hover quick action: reveal in Finder (sibling, not nested in button) */}
      {!bulkMode && (
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-1.5 top-1.5 size-6 rounded-md inline-flex items-center justify-center bg-background/70 backdrop-blur-sm border border-black/6 dark:border-white/8 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-primary hover:border-primary/30 hover:bg-background transition-all duration-150 z-10"
          onClick={(e) => {
            e.stopPropagation();
            onReveal(skill.canonical_path);
          }}
          title={t("skills.revealInFinder")}
          aria-label={t("skills.revealInFinder")}
        >
          <FolderOpen className="size-3" />
        </button>
      )}

      {menu && (
        <div
          className="fixed z-50 w-[180px] rounded-xl glass-elevated p-1 shadow-lg animate-fade-in-up"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/6 transition-colors"
            onClick={() => {
              onReveal(skill.canonical_path);
              setMenu(null);
            }}
          >
            {t("skills.revealInFinder")}
          </button>
          {hasDirectInstall && (
            <button
              className="w-full px-2.5 py-1.5 text-[13px] text-left rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
              onClick={() => {
                onUninstallAll(skill);
                setMenu(null);
              }}
            >
              {t("skills.uninstallAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

function repoSlugFromUrl(url: string): string | null {
  // "https://github.com/MiniMax-AI/skills.git" → "MiniMax-AI/skills"
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  const parts = cleaned.split("/");
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return null;
}

function getSourceLabel(source: unknown, t: (key: string) => string): string {
  if (!source) return t("skills.sourceUnknown");
  if (typeof source === "string") return source === "Unknown" ? t("skills.sourceUnknown") : source;
  if (typeof source !== "object") return t("skills.sourceUnknown");
  const src = source as Record<string, unknown>;
  if ("LocalPath" in src) return t("skills.sourceLocalPath");
  if ("GitRepository" in src) {
    const git = src["GitRepository"] as Record<string, unknown>;
    const slug = typeof git.repo_url === "string" ? repoSlugFromUrl(git.repo_url) : null;
    return slug ?? t("skills.sourceGit");
  }
  if ("SkillsSh" in src) return t("skills.sourceSkillsSh");
  if ("ClawHub" in src) return t("skills.sourceClawHub");
  return t("skills.sourceUnknown");
}

function getSourceRepo(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if ("GitRepository" in src) {
    const git = src["GitRepository"] as Record<string, unknown>;
    return (git.repo_url as string) ?? null;
  }
  if ("SkillsSh" in src) {
    const s = src["SkillsSh"] as Record<string, unknown>;
    return (s.repository as string) ?? null;
  }
  if ("ClawHub" in src) {
    const c = src["ClawHub"] as Record<string, unknown>;
    return (c.repository as string) ?? null;
  }
  return null;
}

function SkillDetail({
  skill,
  detectedAgents,
  busyAgents,
  updating,
  readOnly = false,
  breadcrumb,
  onClose,
  onEdit,
  onSync,
  onUpdate,
  onUninstall,
  onUninstallAll,
}: {
  skill: Skill;
  detectedAgents: AgentConfig[];
  busyAgents: Map<string, BusyOp>;
  updating: boolean;
  readOnly?: boolean;
  breadcrumb?: { label: string; onClick?: () => void }[];
  onClose: () => void;
  onEdit: () => void;
  onSync: (skillId: string, targetAgents: string[]) => void;
  onUpdate: (skillId: string) => void;
  onUninstall: (skillId: string, agentSlug: string) => void;
  onUninstallAll: (skill: Skill) => void;
}) {
  const { t } = useTranslation();
  const allAgentSlugs = new Set(allAgents(skill));
  const syncTargets = detectedAgents.filter(
    (a) => !allAgentSlugs.has(a.slug),
  );
  const sourceLabel = getSourceLabel(skill.source, t);
  const sourceRepo = getSourceRepo(skill.source);
  const metadata = skill.metadata as Record<string, unknown> | null;
  const hasMetadata = !!metadata && Object.keys(metadata).length > 0;

  const [tab, setTab] = useState<DetailTab>("overview");
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Bumped by the header "✨ AI 打标签" quick action — counts as the user's
  // explicit "generate now" click. The editor reacts by scrolling itself
  // into view and firing the same code path as its in-editor button.
  //
  // IMPORTANT: initial value is `null`, NOT 0. The editor uses this as a
  // "never triggered" sentinel — using 0 would make the first mount look
  // like a real trigger because `0 !== lastHandledKeyRef.current (undefined)`,
  // causing the editor to auto-fire AI as soon as any detail panel opens.
  // (This was the "AI 思考中 the moment I click any skill" bug.)
  const [aiTagsRunKey, setAiTagsRunKey] = useState<number | null>(null);

  // Gate the quick action — same readiness check as SkillTagsEditor so the
  // button is enabled iff a click will actually do something useful.
  const { data: aiCfg } = useAIConfig();
  const aiTagsReady = !!aiCfg && aiCfg.enabled && aiCfg.has_api_key;

  // Mirror the editor's mutation state without callback plumbing — the
  // editor's `useAiSuggestSkillTags(skill.id)` uses a per-skill mutationKey
  // and `useIsMutating` returns the live count of matching mutations. When
  // the count > 0 we show a spinner on the header button so users get
  // immediate visual feedback even if the editor section is scrolled
  // offscreen. This survives StrictMode double-mounts and works regardless
  // of which component owns the mutation lifecycle.
  const aiTagsInflight =
    useIsMutating({ mutationKey: aiSuggestSkillTagsKey(skill.id) }) > 0;

  // Reset tab when switching skills
  useEffect(() => {
    setTab("overview");
    setSyncDialogOpen(false);
    setDeleteDialogOpen(false);
    setAiTagsRunKey(null); // back to "never triggered" so new skill's editor stays idle
  }, [skill.id]);

  function handleQuickAITags() {
    setTab("overview");
    // Bump in a microtask so the tab switch commits first; otherwise the
    // editor might be in the middle of unmount/remount and miss the prop.
    queueMicrotask(() => setAiTagsRunKey(Date.now()));
  }

  // Defer the heavy markdown rendering so the panel paints instantly
  const deferredSkillPath = useDeferredValue(skill.canonical_path);
  const isStale = deferredSkillPath !== skill.canonical_path;

  // Load SKILL.md content — try local first, fall back to remote if empty
  const skillMdPath = deferredSkillPath.endsWith("SKILL.md")
    ? deferredSkillPath
    : deferredSkillPath + "/SKILL.md";
  const { data: docContent, isLoading: docLoading } = useQuery<string | null>({
    queryKey: ["skill-content", skillMdPath, sourceRepo],
    queryFn: async () => {
      try {
        const text = await invoke<string>("read_skill_content", { path: skillMdPath });
        const body = extractMarkdownBody(text);
        if (body && body.trim().length > 0) return body;
      } catch { /* fallthrough */ }
      if (sourceRepo) {
        try {
          const text = await invoke<string>("fetch_remote_skill_content", {
            repoUrl: sourceRepo,
            skillName: skill.id,
          });
          return extractMarkdownBody(text);
        } catch { /* fallthrough */ }
      }
      return null;
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  const installedCount = installedAgentCount(skill, detectedAgents);
  const totalAgentsCount = detectedAgents.length;

  const tabs: { id: DetailTab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: "overview", label: t("skills.tabOverview"), icon: <Info className="size-3.5" />, show: true },
    { id: "content", label: t("skills.tabContent"), icon: <FileText className="size-3.5" />, show: true },
    {
      id: "agents",
      label: `${t("skills.tabAgents")} (${installedCount}/${totalAgentsCount})`,
      icon: <Users className="size-3.5" />,
      show: true,
    },
    { id: "metadata", label: t("skills.tabMetadata"), icon: <Cog className="size-3.5" />, show: hasMetadata },
  ];

  return (
    // `min-h-full` (not `h-full`) → when content is short, panel still fills
    // the wrapper; when content is long, panel grows and the OUTER wrapper
    // owns the scroll. This is what makes "wheel anywhere over right pane
    // scrolls without needing to focus the body" work.
    <div className="min-h-full rounded-2xl glass-panel flex flex-col">
      {/* Header — breadcrumb navigation; sticky so it stays visible while
          the user scrolls the long body. Fully opaque background — note
          we use bg-background (not bg-card) because --card is intentionally
          translucent for the glass aesthetic, which made body text bleed
          through when scrolling under the sticky breadcrumb.
          z-30 to outrank the tabs row (z-10) underneath. */}
      <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 border-b border-black/4 dark:border-white/4 bg-background rounded-t-2xl">
        <nav className="flex items-center gap-1 min-w-0 flex-1 text-[12px]" aria-label="Breadcrumb">
          {breadcrumb && breadcrumb.length > 0 ? (
            breadcrumb.map((item, idx) => {
              const isLast = idx === breadcrumb.length - 1;
              return (
                <Fragment key={`${idx}-${item.label}`}>
                  {idx > 0 && (
                    <ChevronRight className="size-3 text-muted-foreground/40 shrink-0" aria-hidden="true" />
                  )}
                  {item.onClick && !isLast ? (
                    <button
                      type="button"
                      onClick={item.onClick}
                      className="rounded px-1 py-0.5 text-muted-foreground hover:text-foreground hover:bg-black/4 dark:hover:bg-white/6 transition-colors truncate max-w-[140px]"
                      title={item.label}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "px-1 py-0.5 truncate",
                        isLast ? "font-medium text-foreground max-w-[260px]" : "text-muted-foreground max-w-[140px]",
                      )}
                      title={item.label}
                    >
                      {item.label}
                    </span>
                  )}
                </Fragment>
              );
            })
          ) : (
            <>
              <Info className="size-3.5 shrink-0 text-muted-foreground" />
              <h3 className="font-medium truncate">{t("skills.detail")}</h3>
            </>
          )}
        </nav>
        <Button variant="ghost" size="icon-sm" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}>
          <X className="size-4" />
        </Button>
      </div>

      {/* === Body (no internal scroll) ===
          We deliberately don't wrap this in `overflow-y-auto` — the OUTER
          wrapper (in SkillsManager) does the scrolling now, so wheel events
          anywhere over the right pane (including its 8px margin) flow
          naturally to the scrollbar without needing the body to be focused.
          The Tabs row stays `sticky` so it pins itself to the top of the
          scroll context (the wrapper) when it scrolls past the breadcrumb. */}
      <div>
        {/* Title + description */}
        <div className="px-4 pt-3 pb-3 space-y-3">
          <div>
            <h2 className="text-base font-semibold leading-tight">{skill.name}</h2>
            {skill.description && (
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed line-clamp-3">
                {skill.description}
              </p>
            )}
          </div>

          {/* AI Explainer — quick AI summary of what this skill does */}
          <AISkillExplainer
            cacheKey={skill.id}
            skillName={skill.name}
            content={docContent ?? skill.description ?? ""}
            contentLoading={docLoading}
          />

          {!readOnly && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="default"
                size="sm"
                className="gap-1.5"
                onClick={onEdit}
              >
                <Pencil className="size-3.5" />
                {t("skills.editSkillMd")}
              </Button>
              {/* AI tag quick action — counts as a manual "generate now"
                  click. Jumps to Overview, scrolls the editor into view and
                  fires the same code path as the in-editor button so users
                  don't have to scroll/click twice. Hidden when AI isn't
                  ready so we never surface a dead button.
                  Spinner is driven by useIsMutating on the per-skill
                  mutationKey — no callback plumbing, no risk of getting
                  stuck on if the editor unmounts mid-flight. */}
              {aiTagsReady && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                  onClick={handleQuickAITags}
                  disabled={aiTagsInflight}
                  title={t("skills.aiTagsQuickActionHint")}
                >
                  {aiTagsInflight ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {aiTagsInflight
                    ? t("skills.aiTagsQuickActionPending")
                    : t("skills.aiTagsQuickAction")}
                </Button>
              )}
              {sourceRepo && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10"
                  disabled={updating}
                  onClick={() => onUpdate(skill.id)}
                >
                  <RefreshCw className={cn("size-3.5", updating && "animate-spin")} />
                  {updating ? t("skills.updating") : t("skills.updateFromSource")}
                </Button>
              )}
              {syncTargets.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                  disabled={busyAgents.size > 0}
                  onClick={() => setSyncDialogOpen(true)}
                  title={t("skills.oneClickSyncTooltip", { count: syncTargets.length })}
                >
                  <Copy className="size-3.5" />
                  {t("skills.oneClickSync")}
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1 text-[10px] font-bold tabular-nums">
                    {syncTargets.length}
                  </span>
                </Button>
              )}

              {/* Delete button — pushed to the right with ml-auto */}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 ml-auto border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50"
                disabled={busyAgents.size > 0}
                onClick={() => setDeleteDialogOpen(true)}
                title={t("skills.deleteTooltip")}
              >
                <Trash2 className="size-3.5" />
                {t("skills.deleteAction")}
              </Button>
            </div>
          )}
        </div>

        {/* Tabs — sticky so they re-pin to just below the breadcrumb when
            scrolling. top-[44px] matches the breadcrumb header height
            (py-2.5 + content + border ≈ 44px) so the two stack cleanly
            without one occluding the other. bg-background (not bg-card)
            because --card is intentionally translucent and would let
            scrolling body text bleed through. z-10 < breadcrumb z-30. */}
        <div className="sticky top-[44px] z-10 px-4 border-b border-border flex items-center gap-0.5 overflow-x-auto bg-background">
          {tabs.filter((tb) => tb.show).map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium border-b-2 transition-colors -mb-px whitespace-nowrap",
                tab === tb.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground/80",
              )}
            >
              {tb.icon}
              <span>{tb.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content — lives inside the SAME scroll context (no nested
            overflow-y) so the user gets exactly one scrollbar. */}
        <div className="p-4 space-y-5">
          <div key={tab} className="animate-fade-in-up">
          {tab === "overview" && (
            <DetailOverviewTab
              skill={skill}
              sourceLabel={sourceLabel}
              sourceRepo={sourceRepo}
              detectedAgents={detectedAgents}
              aiTagsRunKey={aiTagsRunKey}
            />
          )}

          {tab === "content" && (
            <div>
              {isStale || docLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("skills.loading")}
                </div>
              ) : docContent ? (
                <MarkdownContent content={docContent} />
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  {t("skills.noContent")}
                </p>
              )}
            </div>
          )}

          {tab === "metadata" && hasMetadata && (
            <DetailSection label={t("skills.skillMetadata")}>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
                {Object.entries(metadata!).map(([key, value]) => (
                  <Fragment key={key}>
                    <span className="text-xs text-muted-foreground capitalize">{key}</span>
                    <span className="text-xs break-all">
                      {typeof value === "string" ? value : JSON.stringify(value)}
                    </span>
                  </Fragment>
                ))}
              </div>
            </DetailSection>
          )}

          {tab === "agents" && (
            <DetailSection
              label={t("skills.agentsLabel", { installed: installedCount, total: totalAgentsCount })}
            >
              <SkillAgentList
                skill={skill}
                detectedAgents={detectedAgents}
                busyAgents={busyAgents}
                readOnly={readOnly}
                onInstall={(targets) => onSync(skill.id, targets)}
                onUninstall={onUninstall}
              />
            </DetailSection>
          )}
          </div>
        </div>
      </div>

      {/* One-click sync dialog (single skill, multiple targets, default all selected) */}
      {syncDialogOpen && (
        <SyncToAgentsDialog
          skillName={skill.name}
          targets={syncTargets}
          busy={busyAgents.size > 0}
          onClose={() => setSyncDialogOpen(false)}
          onConfirm={(slugs) => {
            onSync(skill.id, slugs);
            setSyncDialogOpen(false);
          }}
        />
      )}

      {/* Delete skill dialog */}
      {deleteDialogOpen && (
        <DeleteSkillDialog
          skill={skill}
          installedAgents={detectedAgents.filter((a) => allAgentSlugs.has(a.slug))}
          busy={busyAgents.size > 0}
          onClose={() => setDeleteDialogOpen(false)}
          onConfirmAll={() => {
            onUninstallAll(skill);
            setDeleteDialogOpen(false);
          }}
          onConfirmSingle={(agentSlug) => {
            onUninstall(skill.id, agentSlug);
            setDeleteDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DetailOverviewTab({
  skill,
  sourceLabel,
  sourceRepo,
  detectedAgents,
  aiTagsRunKey,
}: {
  skill: Skill;
  sourceLabel: string;
  sourceRepo: string | null;
  detectedAgents: AgentConfig[];
  /** Bump from header quick-action to immediately run AI suggestion. `null` = idle. */
  aiTagsRunKey?: number | null;
}) {
  const { t } = useTranslation();
  const sourceKind = getSourceKind(skill.source);
  const SourceIcon =
    sourceKind === "git"
      ? GitBranch
      : sourceKind === "market"
        ? Store
        : sourceKind === "local"
          ? FolderOpen
          : Building;

  return (
    <div className="space-y-5">
      <DetailSection label={t("skills.packageInfo")}>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
          <span className="text-xs text-muted-foreground">{t("skills.sourceLabel")}</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium w-fit">
            <SourceIcon className="size-3" />
            {sourceLabel}
          </span>
          {sourceRepo && (
            <>
              <span className="text-xs text-muted-foreground">{t("skills.repository")}</span>
              <button
                className="text-xs font-mono break-all text-left text-primary hover:underline cursor-pointer"
                onClick={() => openUrl(sourceRepo!)}
              >
                {sourceRepo}
              </button>
            </>
          )}
          <span className="text-xs text-muted-foreground">{t("skills.scope")}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium w-fit",
              skill.scope.type === "SharedGlobal"
                ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                : "bg-muted text-muted-foreground",
            )}
          >
            {skill.scope.type === "SharedGlobal" ? <Globe className="size-3" /> : <Building className="size-3" />}
            {skill.scope.type === "SharedGlobal"
              ? t("skills.scopeGlobal")
              : t("skills.scopeLocal", {
                  name: detectedAgents.find(
                    (a) => a.slug === (skill.scope as { agent: string }).agent,
                  )?.name ?? "Local",
                })}
          </span>
          <span className="text-xs text-muted-foreground">ID</span>
          <span className="text-xs font-mono text-muted-foreground break-all">{skill.id}</span>
        </div>
      </DetailSection>

      {/* Tags — editable; persists into ~/.skills-app/skill-tags.json */}
      <SkillTagsEditor skill={skill} runSuggestKey={aiTagsRunKey} />
    </div>
  );
}

function DetailSection({
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

function SkillEditor({
  skill,
  onClose,
  onBack,
}: {
  skill: Skill;
  onClose: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLoading(true);
    setDirty(false);
    const skillMdPath = skill.canonical_path.endsWith("SKILL.md")
      ? skill.canonical_path
      : skill.canonical_path + "/SKILL.md";
    invoke<string>("read_skill_content", { path: skillMdPath })
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch(() => {
        setContent(t("skills.failedToLoad"));
        setLoading(false);
      });
  }, [skill.canonical_path, t]);

  async function handleSave() {
    setSaving(true);
    const skillMdPath = skill.canonical_path.endsWith("SKILL.md")
      ? skill.canonical_path
      : skill.canonical_path + "/SKILL.md";
    try {
      await invoke("write_skill_content", { path: skillMdPath, content });
      setDirty(false);
      // Invalidate cached content and skill metadata (name/description may have changed)
      queryClient.invalidateQueries({ queryKey: ["skill-content"] });
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    } catch (e) {
      console.error("Save failed:", e instanceof Error ? e.message : String(e));
      toast(t("skills.saveFailed"), "destructive");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 min-w-0 m-2 ml-0 rounded-2xl glass-panel flex flex-col overflow-hidden">
      {/* Header — Editor uses full-area like before */}
      <div className="shrink-0 relative z-20 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            title={t("skills.backToDetail")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium truncate">{skill.name}</h3>
            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
              SKILL.md
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-2">
          {dirty && (
            <Button
              variant="default"
              size="xs"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                t("skills.save")
              )}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Editor */}
      {loading ? (
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          {t("skills.loading")}
        </div>
      ) : (
        <textarea
          className="flex-1 resize-none bg-transparent px-4 py-3 text-sm font-mono leading-relaxed outline-none placeholder:text-muted-foreground"
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
        />
      )}
    </div>
  );
}

/* =====================================================================
 * Phase 1 sub-components: StatCard, SortControl, FilterRow, EmptyStates
 * Phase 3 sub-components: BulkActionBar, BulkSyncDialog
 * ===================================================================== */

const STAT_TONE: Record<string, { active: string; inactive: string; iconActive: string; iconInactive: string }> = {
  default: {
    active: "bg-linear-to-br from-primary/15 to-primary/5 ring-1 ring-primary/30 text-primary shadow-sm",
    inactive: "bg-black/2 dark:bg-white/2 hover:bg-black/4 dark:hover:bg-white/4 hover:-translate-y-0.5 hover:shadow-sm",
    iconActive: "text-primary",
    iconInactive: "text-muted-foreground/70",
  },
  success: {
    active: "bg-linear-to-br from-emerald-500/15 to-emerald-500/5 ring-1 ring-emerald-500/30 text-emerald-700 dark:text-emerald-300 shadow-sm",
    inactive: "bg-black/2 dark:bg-white/2 hover:bg-emerald-500/5 hover:-translate-y-0.5 hover:shadow-sm",
    iconActive: "text-emerald-600 dark:text-emerald-400",
    iconInactive: "text-muted-foreground/70",
  },
  info: {
    active: "bg-linear-to-br from-blue-500/15 to-blue-500/5 ring-1 ring-blue-500/30 text-blue-700 dark:text-blue-300 shadow-sm",
    inactive: "bg-black/2 dark:bg-white/2 hover:bg-blue-500/5 hover:-translate-y-0.5 hover:shadow-sm",
    iconActive: "text-blue-600 dark:text-blue-400",
    iconInactive: "text-muted-foreground/70",
  },
  warn: {
    active: "bg-linear-to-br from-amber-500/15 to-amber-500/5 ring-1 ring-amber-500/30 text-amber-700 dark:text-amber-300 shadow-sm",
    inactive: "bg-black/2 dark:bg-white/2 hover:bg-amber-500/5 hover:-translate-y-0.5 hover:shadow-sm",
    iconActive: "text-amber-600 dark:text-amber-400",
    iconInactive: "text-muted-foreground/70",
  },
};

function FilterPill({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-[12px] font-medium transition-all duration-200 select-none",
        active
          ? "bg-linear-to-br from-primary to-primary/80 text-primary-foreground shadow-sm shadow-primary/20"
          : "bg-black/3 dark:bg-white/4 text-foreground/70 hover:bg-black/6 dark:hover:bg-white/8 hover:text-foreground border border-transparent hover:border-primary/15",
      )}
    >
      {icon}
      <span className="leading-none">{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full text-[10px] tabular-nums leading-none px-1 py-px font-semibold",
            active ? "bg-white/20" : "bg-black/8 dark:bg-white/8 text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function StatCard({
  label,
  value,
  icon,
  hint,
  active,
  onClick,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  hint?: string;
  active: boolean;
  onClick: () => void;
  tone?: "default" | "success" | "info" | "warn";
}) {
  const tones = STAT_TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className={cn(
        "group flex h-full min-w-0 flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200 select-none cursor-pointer overflow-hidden",
        active ? tones.active : tones.inactive,
      )}
    >
      <div className="flex items-center justify-between gap-1 min-w-0">
        <span className={cn("text-[10px] font-medium uppercase tracking-wide leading-none truncate min-w-0", active ? "" : "text-muted-foreground")}>
          {label}
        </span>
        <span className={cn("transition-transform group-hover:scale-110 shrink-0", active ? tones.iconActive : tones.iconInactive)}>
          {icon}
        </span>
      </div>
      <span className="mt-auto text-2xl font-bold tabular-nums leading-tight truncate">{value}</span>
    </button>
  );
}

function SortControl({
  sortKey,
  sortDir,
  onChangeKey,
  onToggleDir,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onChangeKey: (k: SortKey) => void;
  onToggleDir: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const labelMap: Record<SortKey, string> = {
    name: t("skills.sortByName"),
    agents: t("skills.sortByAgentCount"),
  };

  return (
    <div className="relative flex items-center gap-0.5" ref={ref}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-black/4 dark:hover:bg-white/4 transition-colors"
        onClick={() => setOpen((p) => !p)}
        title={t("skills.sortBy")}
      >
        <ArrowUpDown className="size-3" />
        <span>{labelMap[sortKey]}</span>
      </button>
      <button
        type="button"
        className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-black/4 dark:hover:bg-white/4 transition-colors"
        onClick={onToggleDir}
        title={sortDir === "asc" ? t("skills.sortAsc") : t("skills.sortDesc")}
      >
        {sortDir === "asc" ? (
          <ArrowDownAZ className="size-3.5" />
        ) : (
          <ArrowDownZA className="size-3.5" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-50 w-[160px] rounded-xl glass-elevated p-1 shadow-lg animate-fade-in-up">
          {(["name", "agents"] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              className={cn(
                "w-full text-left px-2.5 py-1.5 text-[12px] rounded-lg transition-colors",
                k === sortKey ? "bg-primary/10 text-primary font-medium" : "hover:bg-black/5 dark:hover:bg-white/6",
              )}
              onClick={() => {
                onChangeKey(k);
                setOpen(false);
              }}
            >
              {labelMap[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 w-12 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-black/4 dark:bg-white/4 text-muted-foreground hover:bg-black/8 dark:hover:bg-white/8",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptyStateNoSkills() {
  const { t } = useTranslation();
  // Use react-router to navigate to settings (import paths)
  const goToSettings = () => {
    window.location.hash = "#/settings";
  };
  const goToMarketplace = () => {
    window.location.hash = "#/marketplace";
  };
  return (
    <div className="rounded-2xl border border-dashed border-black/8 dark:border-white/8 p-6 text-center space-y-4">
      <div className="inline-flex size-14 items-center justify-center rounded-2xl glass">
        <Puzzle className="size-7 text-primary/40" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("skills.emptyTitle")}</h3>
        <p className="text-xs text-muted-foreground">
          {t("skills.emptySubtitle")}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 max-w-[240px] mx-auto">
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={goToSettings}
        >
          <GitBranch className="size-3.5" />
          {t("skills.emptyImportGit")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={goToSettings}
        >
          <FolderOpen className="size-3.5" />
          {t("skills.emptyImportLocal")}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="justify-start gap-2"
          onClick={goToMarketplace}
        >
          <Store className="size-3.5" />
          {t("skills.emptyBrowseMarket")}
        </Button>
      </div>
    </div>
  );
}

function EmptyStateNoResults({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-black/6 dark:border-white/6 p-6 text-center">
      <div className="inline-flex size-12 items-center justify-center rounded-xl glass mb-3">
        <Folder className="size-6 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-medium">{t("skills.noResultsTitle")}</p>
      <p className="text-xs text-muted-foreground mt-1">
        {t("skills.noResultsSubtitle")}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 gap-1.5"
        onClick={onClear}
      >
        <X className="size-3" />
        {t("skills.noResultsClear")}
      </Button>
    </div>
  );
}

function BulkActionBar({
  selectedCount,
  running,
  onSelectAll,
  onClear,
  onSync,
  onUpdate,
  onUninstall,
}: {
  selectedCount: number;
  running: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onSync: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
}) {
  const { t } = useTranslation();
  const disabled = selectedCount === 0 || running;
  return (
    <div className="rounded-xl bg-primary/5 ring-1 ring-primary/20 p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tabular-nums">
          {selectedCount > 0
            ? t("skills.bulkSelected", { count: selectedCount })
            : t("skills.bulkMode")}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={running}
            className="text-[10px] text-primary hover:underline disabled:opacity-50"
          >
            {t("skills.bulkSelectAll")}
          </button>
          <span className="text-muted-foreground/30 mx-1">|</span>
          <button
            type="button"
            onClick={onClear}
            disabled={running || selectedCount === 0}
            className="text-[10px] text-muted-foreground hover:underline disabled:opacity-50"
          >
            {t("skills.bulkClear")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          size="xs"
          variant="default"
          className="gap-1"
          disabled={disabled}
          onClick={onSync}
        >
          {running ? <Loader2 className="size-3 animate-spin" /> : <Copy className="size-3" />}
          {t("skills.bulkSyncTo")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="gap-1"
          disabled={disabled}
          onClick={onUpdate}
        >
          <RefreshCw className="size-3" />
          {t("skills.bulkUpdate")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="gap-1 text-destructive hover:bg-destructive/10"
          disabled={disabled}
          onClick={onUninstall}
        >
          <Trash2 className="size-3" />
          {t("skills.bulkUninstall")}
        </Button>
      </div>
    </div>
  );
}

function BulkSyncDialog({
  count,
  detectedAgents,
  running,
  onClose,
  onConfirm,
}: {
  count: number;
  detectedAgents: AgentConfig[];
  running: boolean;
  onClose: () => void;
  onConfirm: (slugs: string[]) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[440px] max-w-[92vw] rounded-2xl glass-dialog p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">{t("skills.bulkSyncTitle")}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {t("skills.bulkSyncDesc", { count })}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={running}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="space-y-1 max-h-[320px] overflow-y-auto">
          {detectedAgents.map((agent) => {
            const checked = selected.has(agent.slug);
            return (
              <button
                key={agent.slug}
                type="button"
                disabled={running}
                onClick={() => toggle(agent.slug)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  checked
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "hover:bg-black/4 dark:hover:bg-white/4",
                  running && "opacity-50",
                )}
              >
                <div
                  className={cn(
                    "size-4 rounded shrink-0 flex items-center justify-center",
                    checked
                      ? "bg-primary text-primary-foreground"
                      : "border border-muted-foreground/40",
                  )}
                >
                  {checked && <CheckSquare className="size-3" />}
                </div>
                <FilterAgentIcon slug={agent.slug} />
                <span className="text-sm font-medium">{agent.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={running}>
            {t("skills.bulkExit")}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={selected.size === 0 || running}
            onClick={() => onConfirm(Array.from(selected))}
            className="gap-1.5"
          >
            {running && <Loader2 className="size-3 animate-spin" />}
            {t("skills.bulkSyncRun")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
 * OverviewPane: top-right card. Shows global stats when filter === "all",
 * otherwise shows current Agent's info card.
 * ===================================================================== */

function OverviewPane({
  filter,
  currentAgent,
  currentAgentStats,
  stats,
  statusFilter,
  scopeFilter,
  sourceFilter,
  setStatusFilter,
  setScopeFilter,
  setSourceFilter,
  tagFilter,
  sortedTags,
  onToggleTag,
  onClearTagFilter,
  batchAITagsCount,
  batchAITagsReady,
  batchAITagsState,
  batchConcurrency,
  onBatchConcurrencyChange,
  onBatchAITags,
  onCancelBatchAITags,
  compact,
  onChangeFilter,
  detectedAgents,
  fullHeight,
  agentFilterPills,
  aiSearchSlot,
}: {
  filter: string;
  currentAgent: AgentConfig | null;
  currentAgentStats: { total: number; direct: number; inherited: number; updatable: number } | null;
  stats: { total: number; installed: number; global: number; updatable: number };
  statusFilter: StatusFilter;
  scopeFilter: ScopeFilter;
  sourceFilter: SourceFilter;
  setStatusFilter: (s: StatusFilter) => void;
  setScopeFilter: (s: ScopeFilter) => void;
  setSourceFilter: (s: SourceFilter) => void;
  /** Currently active tag set (AND-filtered). */
  tagFilter: Set<string>;
  /** All available tags in scope, sorted desc by count then alpha. */
  sortedTags: Array<[string, number]>;
  onToggleTag: (tag: string) => void;
  onClearTagFilter: () => void;
  /** Count of skills in current scope that have NO tags — drives the
   *  "✨ Batch generate for N" button label. */
  batchAITagsCount: number;
  /** True iff AI config has an API key AND is enabled. Hides batch button
   *  otherwise (the per-skill UI already handles the not-ready states). */
  batchAITagsReady: boolean;
  batchAITagsState: { running: boolean; done: number; total: number; errors: number };
  /** Per-user concurrency choice (1/2/3). 1 is safest for free-tier QPS caps. */
  batchConcurrency: 1 | 2 | 3;
  onBatchConcurrencyChange: (n: 1 | 2 | 3) => void;
  onBatchAITags: () => void;
  /** Cancels an in-flight batch (workers exit after their current call). */
  onCancelBatchAITags: () => void;
  compact: boolean;
  onChangeFilter: (slug: string) => void;
  detectedAgents: AgentConfig[];
  /** When true, fill parent container height (used in top-of-page layout). */
  fullHeight?: boolean;
  /** Optional Agent filter pills row rendered above stats / agent info. */
  agentFilterPills?: React.ReactNode;
  /** Optional AI search slot rendered next to title (collapsed) or above pills (expanded). */
  aiSearchSlot?: React.ReactNode;
}) {
  const { t } = useTranslation();

  const tagCloud = (
    <TagCloudRow
      sortedTags={sortedTags}
      tagFilter={tagFilter}
      onToggleTag={onToggleTag}
      onClearTagFilter={onClearTagFilter}
      batchAITagsCount={batchAITagsCount}
      batchAITagsReady={batchAITagsReady}
      batchAITagsState={batchAITagsState}
      batchConcurrency={batchConcurrency}
      onBatchConcurrencyChange={onBatchConcurrencyChange}
      onBatchAITags={onBatchAITags}
      onCancelBatchAITags={onCancelBatchAITags}
    />
  );

  if (filter === "all") {
    // Global view — show 4 stat cards (compact responsive layout).
    // In fullHeight mode we deliberately DO NOT add `overflow-y-auto` here:
    // scrolling is owned by the outer wrapper so the panel itself never
    // grows an inner scrollbar that looks tacked-on.
    return (
      <div
        key="all-overview"
        className={cn(
          "rounded-2xl glass-panel p-3 transition-all duration-300 relative animate-fade-in min-w-0 overflow-hidden",
          fullHeight ? "flex flex-col shrink-0" : "shrink-0",
          compact && "py-2",
        )}
      >
        {/* Decorative gradient orb */}
        <div className="pointer-events-none absolute -top-12 -right-12 size-32 rounded-full bg-linear-to-br from-primary/20 to-transparent blur-2xl" aria-hidden="true" />
        {aiSearchSlot && (
          <div className="relative shrink-0 mb-2.5">{aiSearchSlot}</div>
        )}
        {agentFilterPills && (
          <div className="relative shrink-0 mb-2.5">{agentFilterPills}</div>
        )}
        <div className={cn("relative grid grid-cols-4 gap-1.5 min-w-0", fullHeight && "shrink-0")}>
          <StatCard
            label={t("skills.statsTotal")}
            value={stats.total}
            icon={<Puzzle className="size-3.5" />}
            hint={t("skills.statsTotalHint")}
            active={statusFilter === "all" && scopeFilter === "all" && sourceFilter === "all"}
            onClick={() => {
              setStatusFilter("all");
              setScopeFilter("all");
              setSourceFilter("all");
            }}
          />
          <StatCard
            label={t("skills.statsInstalled")}
            value={stats.installed}
            icon={<CheckSquare className="size-3.5" />}
            hint={t("skills.statsInstalledHint")}
            active={statusFilter === "installed"}
            onClick={() => setStatusFilter(statusFilter === "installed" ? "all" : "installed")}
            tone="success"
          />
          <StatCard
            label={t("skills.statsGlobal")}
            value={stats.global}
            icon={<Globe className="size-3.5" />}
            hint={t("skills.statsGlobalHint")}
            active={scopeFilter === "global"}
            onClick={() => setScopeFilter(scopeFilter === "global" ? "all" : "global")}
            tone="info"
          />
          <StatCard
            label={t("skills.statsHasUpdate")}
            value={stats.updatable}
            icon={<GitBranch className="size-3.5" />}
            hint={t("skills.statsHasUpdateHint")}
            active={sourceFilter === "git"}
            onClick={() => setSourceFilter(sourceFilter === "git" ? "all" : "git")}
            tone="warn"
          />
        </div>
        {/* Tag cloud row — only renders when at least one tag exists */}
        {tagCloud}
      </div>
    );
  }

  // Per-agent view
  if (!currentAgent || !currentAgentStats) {
    return null;
  }
  return (
    <AgentInfoCard
      agent={currentAgent}
      stats={currentAgentStats}
      compact={compact}
      onClear={() => onChangeFilter("all")}
      otherAgents={detectedAgents.filter((a) => a.slug !== currentAgent.slug)}
      onSwitchAgent={onChangeFilter}
      fullHeight={fullHeight}
      agentFilterPills={agentFilterPills}
      aiSearchSlot={aiSearchSlot}
      tagCloud={tagCloud}
    />
  );
}

function AgentInfoCard({
  agent,
  stats,
  compact,
  onClear,
  otherAgents,
  onSwitchAgent,
  fullHeight,
  agentFilterPills,
  aiSearchSlot,
  tagCloud,
}: {
  agent: AgentConfig;
  stats: { total: number; direct: number; inherited: number; updatable: number };
  compact: boolean;
  onClear: () => void;
  otherAgents: AgentConfig[];
  onSwitchAgent: (slug: string) => void;
  fullHeight?: boolean;
  agentFilterPills?: React.ReactNode;
  aiSearchSlot?: React.ReactNode;
  tagCloud?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const icon = getAgentIcon(agent.slug);

  return (
    <div
      key={`agent-${agent.slug}`}
      className={cn(
        "rounded-2xl glass-panel p-3 transition-all duration-300 relative animate-fade-in min-w-0 overflow-hidden",
        // See GlobalOverviewCard comment: scrolling is owned by the outer wrapper.
        fullHeight ? "flex flex-col shrink-0" : "shrink-0",
        compact && "py-2",
      )}
    >
      {aiSearchSlot && (
        <div className="relative shrink-0 mb-2">{aiSearchSlot}</div>
      )}
      {agentFilterPills && (
        <div className="relative shrink-0 mb-2.5">{agentFilterPills}</div>
      )}
      {/* Decorative gradient — colored by agent for visual identity */}
      <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-linear-to-br from-primary/25 to-transparent blur-2xl" aria-hidden="true" />

      {/* Header row: agent icon + name + clear */}
      <div className="relative flex items-center gap-2.5">
        <div className="size-9 rounded-xl overflow-hidden bg-linear-to-br from-black/5 to-black/10 dark:from-white/5 dark:to-white/10 ring-1 ring-black/5 dark:ring-white/10 flex items-center justify-center shrink-0">
          {icon.type === "component" ? (
            <icon.Component className="size-5" aria-hidden="true" />
          ) : (
            <img src={icon.src} alt="" className={cn("size-5", icon.monochrome && "dark:invert")} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold truncate">{agent.name}</h3>
            {agent.detected && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-px text-[9px] font-medium leading-none">
                <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                {t("dashboard.detected")}
              </span>
            )}
          </div>
          {!compact && (
            <p className="text-[11px] text-muted-foreground truncate font-mono mt-0.5">
              {agent.slug}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          title={t("skills.overviewClearFilter")}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* 4 mini stats */}
      <div className={cn("relative grid grid-cols-4 gap-1.5 min-w-0", compact ? "mt-2" : "mt-3")}>
        <MiniStat label={t("skills.overviewAgentTotal")} value={stats.total} tone="default" />
        <MiniStat label={t("skills.overviewAgentDirect")} value={stats.direct} tone="success" />
        <MiniStat label={t("skills.overviewAgentInherited")} value={stats.inherited} tone="muted" />
        <MiniStat label={t("skills.overviewAgentUpdatable")} value={stats.updatable} tone="warn" />
      </div>
      {/* Tag cloud row — surfaces user / frontmatter tags for fast narrowing */}
      {tagCloud}

      {/* Quick switch row (hidden when compact) */}
      {!compact && otherAgents.length > 0 && (
        <div className="relative mt-2.5 pt-2.5 border-t border-border/60">
          <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5">
            {t("skills.overviewSwitch")}
          </p>
          <div className="flex flex-wrap gap-1">
            {otherAgents.map((a) => (
              <button
                key={a.slug}
                type="button"
                onClick={() => onSwitchAgent(a.slug)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] bg-black/4 dark:bg-white/4 hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/20 transition-all"
              >
                <FilterAgentIcon slug={a.slug} />
                <span>{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline tag cloud — shows up to 20 most-frequent tags by default, then
 * "Show all" to expand. Clicking toggles the tag in the parent filter set
 * (AND semantics — adding more tags narrows results).
 *
 * Renders nothing when there are no tags, so the OverviewPane stays compact
 * for users who haven't tagged anything yet.
 */
function TagCloudRow({
  sortedTags,
  tagFilter,
  onToggleTag,
  onClearTagFilter,
  batchAITagsCount,
  batchAITagsReady,
  batchAITagsState,
  batchConcurrency,
  onBatchConcurrencyChange,
  onBatchAITags,
  onCancelBatchAITags,
}: {
  sortedTags: Array<[string, number]>;
  tagFilter: Set<string>;
  onToggleTag: (tag: string) => void;
  onClearTagFilter: () => void;
  batchAITagsCount: number;
  batchAITagsReady: boolean;
  batchAITagsState: { running: boolean; done: number; total: number; errors: number };
  batchConcurrency: 1 | 2 | 3;
  onBatchConcurrencyChange: (n: 1 | 2 | 3) => void;
  onBatchAITags: () => void;
  onCancelBatchAITags: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // We still render the row if a batch is running or if there are untagged
  // skills the user could batch-tag — even when no tags exist yet — so the
  // entry point is discoverable from a fresh install.
  const showBatchEntry = batchAITagsReady && (batchAITagsCount > 0 || batchAITagsState.running);
  if (sortedTags.length === 0 && tagFilter.size === 0 && !showBatchEntry) {
    return null;
  }

  const COLLAPSED_LIMIT = 20;
  const visible = expanded ? sortedTags : sortedTags.slice(0, COLLAPSED_LIMIT);
  const hasMore = sortedTags.length > COLLAPSED_LIMIT;

  const batchProgressPct = batchAITagsState.total > 0
    ? Math.round((batchAITagsState.done / batchAITagsState.total) * 100)
    : 0;

  return (
    <div className="relative mt-2.5 pt-2.5 border-t border-border/40 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
          <TagIcon className="size-3 text-primary/70" />
          {t("skills.tagsOverviewLabel")}
          {tagFilter.size > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-semibold">
              {t("skills.tagsActiveCount", { count: tagFilter.size })}
            </span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          {/* Batch AI tag controls — only when AI ready AND untagged skills exist.
              While a batch is running we show a progress chip with cancel;
              otherwise show the trigger button + a small concurrency selector
              so users can tune QPS for their provider's tier. */}
          {showBatchEntry && (
            batchAITagsState.running ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary pl-2 pr-1 py-0.5 text-[10px] font-medium">
                <Loader2 className="size-3 animate-spin" />
                <span className="tabular-nums">
                  {t("skills.aiTagsBatchProgress", {
                    done: batchAITagsState.done,
                    total: batchAITagsState.total,
                    pct: batchProgressPct,
                  })}
                </span>
                <button
                  type="button"
                  onClick={onCancelBatchAITags}
                  title={t("skills.aiTagsBatchCancel")}
                  className="ml-1 rounded-full p-0.5 hover:bg-primary/20 transition-colors"
                  aria-label={t("skills.aiTagsBatchCancel")}
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ) : (
              <>
                {/* Concurrency selector — three tiny pills so the choice
                    is one click, no dropdown. 1=safe (free tier), 3=fast. */}
                <div
                  className="inline-flex items-center gap-0 rounded-full border border-border/50 overflow-hidden text-[9.5px] font-medium"
                  title={t("skills.aiTagsBatchConcurrencyHint")}
                >
                  <span className="px-1.5 py-0.5 text-muted-foreground/70">
                    {t("skills.aiTagsBatchConcurrencyLabel")}
                  </span>
                  {([1, 2, 3] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onBatchConcurrencyChange(n)}
                      className={cn(
                        "px-1.5 py-0.5 transition-colors tabular-nums",
                        batchConcurrency === n
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onBatchAITags}
                  title={t("skills.aiTagsBatchHint", { count: batchAITagsCount })}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground px-2 py-0.5 text-[10px] font-semibold transition-colors"
                >
                  <Sparkles className="size-3" />
                  {t("skills.aiTagsBatchButton", { count: batchAITagsCount })}
                </button>
              </>
            )
          )}
          {tagFilter.size > 0 && (
            <button
              type="button"
              onClick={onClearTagFilter}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("skills.tagsClearFilter")}
            </button>
          )}
        </div>
      </div>
      {sortedTags.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/60 italic">
          {t("skills.tagsEmptyCloud")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1 min-w-0">
          {visible.map(([tag, count]) => {
            const active = tagFilter.has(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onToggleTag(tag)}
                title={`${tag} · ${count}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-all max-w-[160px]",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-black/4 dark:bg-white/5 text-muted-foreground hover:bg-primary/15 hover:text-primary",
                )}
              >
                <span className="truncate">{tag}</span>
                <span
                  className={cn(
                    "tabular-nums text-[9px] shrink-0",
                    active ? "text-primary-foreground/80" : "text-muted-foreground/50",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center rounded-full border border-dashed border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/30 transition-colors"
            >
              {expanded
                ? t("skills.tagsShowLess")
                : t("skills.tagsShowMore", { count: sortedTags.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "muted" | "warn";
}) {
  const toneClass: Record<string, string> = {
    default: "text-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    muted: "text-muted-foreground",
    warn: "text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="rounded-lg bg-black/2 dark:bg-white/2 px-2 py-1.5 min-w-0 overflow-hidden">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground/70 leading-none mb-1 truncate">
        {label}
      </div>
      <div className={cn("text-base font-semibold tabular-nums leading-none truncate", toneClass[tone])}>
        {value}
      </div>
    </div>
  );
}

function EmptyDetailPane({
  hasResults,
  hasAnySkills,
}: {
  hasResults: boolean;
  hasAnySkills: boolean;
}) {
  const { t } = useTranslation();

  const message = hasAnySkills
    ? hasResults
      ? t("skills.selectToView")
      : t("skills.noResultsTitle")
    : t("skills.emptyTitle");

  return (
    <div className="h-full rounded-2xl glass-panel flex flex-col items-center justify-center px-6 py-10 text-center relative overflow-hidden">
      {/* Decorative gradient blobs */}
      <div className="pointer-events-none absolute -top-20 -left-20 size-64 rounded-full bg-linear-to-br from-primary/15 to-transparent blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 size-64 rounded-full bg-linear-to-tl from-blue-500/10 to-transparent blur-3xl" aria-hidden="true" />

      {/* Floating shapes */}
      <div className="relative">
        <div className="inline-flex size-20 items-center justify-center rounded-3xl glass shadow-lg">
          <Puzzle className="size-10 text-primary/40" />
        </div>
        {/* Decorative dots around the icon */}
        <div className="absolute -top-2 -right-3 size-4 rounded-full bg-primary/20 animate-pulse" aria-hidden="true" />
        <div className="absolute -bottom-1 -left-3 size-3 rounded-full bg-blue-500/20 animate-pulse" aria-hidden="true" style={{ animationDelay: "0.5s" }} />
        <div className="absolute top-1/2 -right-6 size-2 rounded-full bg-emerald-500/30 animate-pulse" aria-hidden="true" style={{ animationDelay: "1s" }} />
      </div>

      <p className="relative mt-5 max-w-xs text-sm text-muted-foreground/80 leading-relaxed">
        {message}
      </p>

      {/* Keyboard hint */}
      {hasAnySkills && hasResults && (
        <div className="relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-black/3 dark:bg-white/3 px-3 py-1 text-[10px] text-muted-foreground/60">
          <kbd className="font-sans rounded bg-black/5 dark:bg-white/5 px-1 text-[9px]">↑↓</kbd>
          <span>{t("skills.tipNavigateOrClick")}</span>
        </div>
      )}
    </div>
  );
}

// AISkillExplainer & ExplainSection moved to src/components/AISkillExplainer.tsx
// (shared between SkillsManager and Marketplace)

// ============================================================
//  Sync-to-Agents Dialog
//  - Default: all targets selected
//  - User can toggle individual agents
//  - Quick "select all" / "select none" buttons
// ============================================================
function SyncToAgentsDialog({
  skillName,
  targets,
  busy,
  onClose,
  onConfirm,
}: {
  skillName: string;
  targets: AgentConfig[];
  busy?: boolean;
  onClose: () => void;
  onConfirm: (slugs: string[]) => void;
}) {
  const { t } = useTranslation();
  // Default: all targets selected (one-click sync)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(targets.map((a) => a.slug)),
  );

  const toggle = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const allSelected = selected.size === targets.length;
  const noneSelected = selected.size === 0;
  const selectAll = () => setSelected(new Set(targets.map((a) => a.slug)));
  const selectNone = () => setSelected(new Set());

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 backdrop-blur-md animate-fade-in"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-[460px] max-w-[92vw] rounded-2xl glass-dialog p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold flex items-center gap-1.5">
              <Copy className="size-4 text-emerald-500" />
              {t("skills.oneClickSyncTitle")}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {t("skills.oneClickSyncDesc", { name: skillName })}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={busy}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Quick toggles */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground tabular-nums">
            {t("skills.oneClickSyncSelected", {
              selected: selected.size,
              total: targets.length,
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
              {t("skills.oneClickSyncSelectAll")}
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
              {t("skills.oneClickSyncSelectNone")}
            </button>
          </div>
        </div>

        {/* Agent list with checkboxes */}
        <div className="space-y-1 max-h-[300px] overflow-y-auto -mx-1 px-1">
          {targets.map((agent) => {
            const checked = selected.has(agent.slug);
            return (
              <button
                key={agent.slug}
                type="button"
                disabled={busy}
                onClick={() => toggle(agent.slug)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all",
                  checked
                    ? "bg-emerald-500/10 ring-1 ring-emerald-500/30"
                    : "hover:bg-black/4 dark:hover:bg-white/4",
                  busy && "opacity-50",
                )}
              >
                <div
                  className={cn(
                    "size-4 rounded shrink-0 flex items-center justify-center transition-all",
                    checked
                      ? "bg-emerald-500 text-white"
                      : "border border-muted-foreground/40",
                  )}
                >
                  {checked && <CheckSquare className="size-3" />}
                </div>
                <FilterAgentIcon slug={agent.slug} />
                <span className="text-sm font-medium flex-1 min-w-0 truncate">{agent.name}</span>
                {agent.detected && (
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
            {t("skills.oneClickSyncHint")}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              {t("skills.bulkExit")}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={selected.size === 0 || busy}
              onClick={() => onConfirm(Array.from(selected))}
              className="gap-1.5"
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              <Copy className="size-3" />
              {t("skills.oneClickSyncConfirm", { count: selected.size })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  Delete Skill Dialog
//  - Two modes: "all" (彻底删除) | "single" (从单个 agent 删除)
//  - Default mode: "all"
//  - Two-step confirm to prevent accidental deletion
// ============================================================
type DeleteMode = "all" | "single";

function DeleteSkillDialog({
  skill,
  installedAgents,
  busy,
  onClose,
  onConfirmAll,
  onConfirmSingle,
}: {
  skill: Skill;
  installedAgents: AgentConfig[];
  busy?: boolean;
  onClose: () => void;
  onConfirmAll: () => void;
  onConfirmSingle: (agentSlug: string) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<DeleteMode>("all");
  const [singleSlug, setSingleSlug] = useState<string>(
    installedAgents[0]?.slug ?? "",
  );
  // Two-step confirm: first click arms; second click executes
  const [armed, setArmed] = useState(false);

  // ESC closes dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Reset armed state when mode/target changes
  useEffect(() => {
    setArmed(false);
  }, [mode, singleSlug]);

  const handleConfirm = () => {
    if (busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    if (mode === "all") {
      onConfirmAll();
    } else if (singleSlug) {
      onConfirmSingle(singleSlug);
    }
  };

  const canSingle = installedAgents.length > 0;
  const isSingleAgent = installedAgents.length === 1;

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
          <div className="min-w-0 flex-1 flex items-start gap-2.5">
            <div className="size-9 shrink-0 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center">
              <Trash2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">
                {t("skills.deleteDialogTitle")}
              </h2>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {t("skills.deleteDialogDesc", { name: skill.name })}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={busy}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Mode selector — two radio cards */}
        <div className="space-y-1.5">
          <DeleteModeCard
            active={mode === "all"}
            tone="danger"
            icon={<Trash2 className="size-3.5" />}
            title={t("skills.deleteModeAll")}
            desc={t("skills.deleteModeAllDesc", {
              count: installedAgents.length,
            })}
            onClick={() => setMode("all")}
          />
          {canSingle && !isSingleAgent && (
            <DeleteModeCard
              active={mode === "single"}
              tone="warn"
              icon={<X className="size-3.5" />}
              title={t("skills.deleteModeSingle")}
              desc={t("skills.deleteModeSingleDesc")}
              onClick={() => setMode("single")}
            />
          )}
        </div>

        {/* Body — content varies by mode */}
        {mode === "all" && installedAgents.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t("skills.deleteImpactAll", { count: installedAgents.length })}
            </h4>
            <div className="rounded-lg border border-destructive/20 bg-destructive/4 p-2 space-y-0.5 max-h-[140px] overflow-y-auto">
              {installedAgents.map((agent) => (
                <div
                  key={agent.slug}
                  className="flex items-center gap-2 px-1.5 py-1 text-[12px]"
                >
                  <X className="size-3 text-destructive shrink-0" />
                  <FilterAgentIcon slug={agent.slug} />
                  <span className="font-medium">{agent.name}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 px-1.5 py-1 text-[12px] border-t border-destructive/20 pt-1.5 mt-1">
                <X className="size-3 text-destructive shrink-0" />
                <Folder className="size-3 text-destructive" />
                <span className="font-medium">~/.agents/skills/{skill.id}/</span>
              </div>
            </div>
          </div>
        )}

        {mode === "single" && canSingle && (
          <div className="space-y-1.5">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t("skills.deleteSelectAgent")}
            </h4>
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {installedAgents.map((agent) => (
                <button
                  key={agent.slug}
                  type="button"
                  disabled={busy}
                  onClick={() => setSingleSlug(agent.slug)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all",
                    singleSlug === agent.slug
                      ? "bg-amber-500/10 ring-1 ring-amber-500/30"
                      : "hover:bg-black/4 dark:hover:bg-white/4",
                    busy && "opacity-50",
                  )}
                >
                  <div
                    className={cn(
                      "size-4 rounded-full shrink-0 flex items-center justify-center transition-all",
                      singleSlug === agent.slug
                        ? "bg-amber-500 ring-2 ring-amber-500/30"
                        : "border border-muted-foreground/40",
                    )}
                  >
                    {singleSlug === agent.slug && (
                      <span className="size-1.5 rounded-full bg-white" />
                    )}
                  </div>
                  <FilterAgentIcon slug={agent.slug} />
                  <span className="text-sm font-medium flex-1 min-w-0 truncate">
                    {agent.name}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-muted-foreground/70 px-1 pt-1">
              {t("skills.deleteSingleHint")}
            </p>
          </div>
        )}

        {/* Footer warning + actions */}
        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-[11px] text-destructive/80 leading-relaxed flex items-start gap-1.5">
            <span className="text-base leading-none">⚠️</span>
            <span>{t("skills.deleteWarning")}</span>
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              {t("skills.bulkExit")}
            </Button>
            <Button
              variant={armed ? "destructive" : "outline"}
              size="sm"
              disabled={busy || (mode === "single" && !singleSlug)}
              onClick={handleConfirm}
              className={cn(
                "gap-1.5 transition-all",
                !armed && "border-destructive/40 text-destructive hover:bg-destructive/10",
              )}
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              <Trash2 className="size-3" />
              {armed
                ? t("skills.deleteConfirmFinal")
                : mode === "all"
                  ? t("skills.deleteConfirmAll")
                  : t("skills.deleteConfirmSingle")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteModeCard({
  active,
  tone,
  icon,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  tone: "danger" | "warn";
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  const tones = {
    danger: {
      activeRing: "ring-destructive/40 bg-destructive/8",
      activeBadge: "bg-destructive text-destructive-foreground",
      activeText: "text-destructive",
    },
    warn: {
      activeRing: "ring-amber-500/40 bg-amber-500/8",
      activeBadge: "bg-amber-500 text-white",
      activeText: "text-amber-700 dark:text-amber-400",
    },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all",
        active
          ? cn("ring-1", tones.activeRing)
          : "hover:bg-black/3 dark:hover:bg-white/3 ring-1 ring-transparent",
      )}
    >
      <div
        className={cn(
          "size-5 shrink-0 rounded-md flex items-center justify-center mt-0.5 transition-all",
          active
            ? tones.activeBadge
            : "bg-black/4 dark:bg-white/6 text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[12.5px] font-semibold leading-snug",
            active ? tones.activeText : "text-foreground",
          )}
        >
          {title}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </button>
  );
}

// ExplainSection moved to src/components/AISkillExplainer.tsx
