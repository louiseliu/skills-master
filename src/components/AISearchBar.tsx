import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Loader2,
  X,
  ArrowRight,
  Download,
  Package,
  Zap,
  Brain,
  Search,
  CheckCircle2,
  Circle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAIConfig,
  useEnableAI,
  aiSearchUnified,
  aiStreamSearchExplanation,
  type UnifiedSearchResponse,
  type UnifiedRecommendation,
  type UnifiedScope,
  type UnifiedLocalCandidate,
} from "@/hooks/useAISettings";
import { useSkills, type Skill } from "@/hooks/useSkills";
import { cn } from "@/lib/utils";
import InstallToAgentsDialog from "@/components/InstallToAgentsDialog";

const SCOPES: UnifiedScope[] = ["all", "local", "marketplace"];

/**
 * Pipeline phases shown to the user. Driven by both timing and real
 * events from the streaming backend command (`thinking` arrives via
 * channel, the rest are advanced locally as work progresses).
 */
type StepCode = "collecting" | "scanning" | "thinking" | "polishing" | null;
const STEP_ORDER: Exclude<StepCode, null>[] = [
  "collecting",
  "scanning",
  "thinking",
  "polishing",
];

export default function AISearchBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: config } = useAIConfig();
  const enableAI = useEnableAI();
  const { data: skills } = useSkills();

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<UnifiedScope>("all");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UnifiedSearchResponse | null>(null);
  // Tracks how the current `result` was produced so we can render the
  // right banner (AI smart recs vs basic keyword filter).
  const [resultMode, setResultMode] = useState<"ai" | "basic" | null>(null);
  const [showSetupHint, setShowSetupHint] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<UnifiedRecommendation | null>(null);

  // === Streaming-progress state ===
  const [currentStep, setCurrentStep] = useState<StepCode>(null);
  const [streamingText, setStreamingText] = useState("");
  const [streamDone, setStreamDone] = useState(false);
  const [streamLatencyMs, setStreamLatencyMs] = useState<number | null>(null);
  // Per-run guard so late events from a previous query never leak into a new one.
  const runIdRef = useRef(0);

  const hasApiKey = !!config?.has_api_key;
  const isEnabled = !!config?.enabled;
  const isConfigured = hasApiKey && isEnabled;
  const needsEnableOnly = hasApiKey && !isEnabled;

  async function handleEnableAI() {
    if (!config) return;
    setEnableError(null);
    try {
      await enableAI.mutateAsync(config);
      setShowSetupHint(false);
    } catch (e) {
      setEnableError(e instanceof Error ? e.message : String(e));
    }
  }

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const q = query.trim();
      if (!q) return;

      const localCandidates: UnifiedLocalCandidate[] = (skills ?? []).map((s: Skill) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
      }));

      // === Fallback path: no AI configured ===
      // Marketplace search inherently needs the AI ranker, so we surface the
      // setup hint there. Local / "all" scope can fall back to a fast
      // client-side keyword filter — no backend, no cost.
      if (!isConfigured) {
        if (scope === "marketplace") {
          setShowSetupHint(true);
          return;
        }
        runIdRef.current++;
        setSearching(false);
        setError(null);
        setStreamingText("");
        setStreamDone(false);
        setStreamLatencyMs(null);
        setCurrentStep(null);
        const localResults = basicLocalFilter(q, skills);
        setResult({
          local: localResults,
          marketplace: [],
          explanation: "",
        });
        setResultMode("basic");
        return;
      }

      const myRun = ++runIdRef.current;
      // Reset everything for this run
      setSearching(true);
      setError(null);
      setResult(null);
      setResultMode(null);
      setStreamingText("");
      setStreamDone(false);
      setStreamLatencyMs(null);
      setCurrentStep("collecting");

      // Phase 1: collecting (visual only, real cost is negligible)
      await sleep(180);
      if (runIdRef.current !== myRun) return;

      // Phase 2: scanning (advances when search needs marketplace data)
      if (scope === "all" || scope === "marketplace") {
        setCurrentStep("scanning");
        await sleep(220);
        if (runIdRef.current !== myRun) return;
      }

      // Phase 3 & 4 run in parallel: explanation stream + structured search.
      // The structured call almost always takes longer than the short
      // explanation stream, so by the time results arrive the user has
      // already been watching meaningful text appear character-by-character.
      const streamPromise = aiStreamSearchExplanation(
        q,
        scope,
        localCandidates.length,
        {
          onStep: (code) => {
            if (runIdRef.current !== myRun) return;
            if (code === "thinking") setCurrentStep("thinking");
          },
          onDelta: (text) => {
            if (runIdRef.current !== myRun) return;
            setStreamingText((prev) => prev + text);
          },
          onDone: (_full, ms) => {
            if (runIdRef.current !== myRun) return;
            setStreamDone(true);
            setStreamLatencyMs(ms);
          },
          onError: () => {
            // Non-fatal: structured search still drives the final answer.
            // We silently swallow stream errors so the user isn't doubly alerted.
          },
        },
      ).catch(() => {
        /* see onError above */
      });

      const searchPromise = aiSearchUnified(q, scope, localCandidates);

      try {
        const [resp] = await Promise.all([
          searchPromise,
          streamPromise.then(() => undefined),
        ]);
        if (runIdRef.current !== myRun) return;
        setCurrentStep("polishing");
        await sleep(200);
        if (runIdRef.current !== myRun) return;
        setResult(resp);
        setResultMode("ai");
        setCurrentStep(null);
      } catch (err) {
        if (runIdRef.current !== myRun) return;
        setError(t("aiSearch.error", { message: err instanceof Error ? err.message : String(err) }));
        setCurrentStep(null);
      } finally {
        if (runIdRef.current === myRun) setSearching(false);
      }
    },
    [query, scope, isConfigured, skills, t],
  );

  function handleClear() {
    runIdRef.current++;
    setQuery("");
    setResult(null);
    setResultMode(null);
    setError(null);
    setShowSetupHint(false);
    setStreamingText("");
    setStreamDone(false);
    setStreamLatencyMs(null);
    setCurrentStep(null);
  }

  function applyExample(text: string) {
    setQuery(text);
    setResult(null);
    setResultMode(null);
    setError(null);
  }

  function handleLocalClick(rec: UnifiedRecommendation) {
    navigate(`/skills?selected=${encodeURIComponent(rec.skill_id)}`);
  }

  function handleMarketplaceClick(rec: UnifiedRecommendation) {
    if (!rec.repository) return;
    setInstallTarget(rec);
  }

  const showExamples = !query && !result && !searching && !error;
  const hasAnyResults =
    result && (result.local.length > 0 || result.marketplace.length > 0);

  return (
    <div className="space-y-3 min-w-0">
      {/* Search input — dual mode:
          - configured: AI smart search (primary-themed Sparkles)
          - not configured: local keyword fallback (neutral Search icon) */}
      <form onSubmit={handleSubmit} className="relative min-w-0">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          {isConfigured ? (
            <Sparkles className="size-4 text-primary" />
          ) : (
            <Search className="size-4 text-muted-foreground/70" />
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (showSetupHint) setShowSetupHint(false);
          }}
          placeholder={
            isConfigured ? t("aiSearch.placeholder") : t("aiSearch.basicPlaceholder")
          }
          className={cn(
            "w-full rounded-2xl border px-10 py-2.5 text-sm outline-none focus-visible:ring-2 placeholder:text-muted-foreground/60",
            isConfigured
              ? "border-primary/20 bg-primary/4 focus-visible:ring-primary/30"
              : "border-border/60 bg-background/60 focus-visible:ring-ring/40",
          )}
        />
        {(query || result || error) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute inset-y-0 right-12 flex items-center pr-2 text-muted-foreground hover:text-foreground"
            aria-label="clear"
          >
            <X className="size-3.5" />
          </button>
        )}
        <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">
          <Button
            type="submit"
            size="icon-sm"
            variant={isConfigured ? "default" : "outline"}
            disabled={searching || !query.trim()}
            className="rounded-xl"
          >
            {searching ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
          </Button>
        </div>
      </form>

      {/* Scope toggle */}
      {(query || result) && (
        <div className="flex items-center gap-1.5 px-1">
          {SCOPES.map((s) => {
            const active = scope === s;
            const labelKey = `aiSearch.scope${s.charAt(0).toUpperCase() + s.slice(1)}`;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  active
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "border border-border/40 text-muted-foreground hover:bg-muted/30",
                )}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      )}

      {/* Examples */}
      {showExamples && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-[11px] text-muted-foreground/70">{t("aiSearch.examplesLabel")}</span>
          {(["example1", "example2", "example3"] as const).map((key) => {
            const text = t(`aiSearch.${key}`);
            return (
              <button
                key={key}
                type="button"
                onClick={() => applyExample(text)}
                className="rounded-full border border-border/50 bg-background/40 px-2.5 py-0.5 text-[11px] text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
              >
                {text}
              </button>
            );
          })}
        </div>
      )}

      {/* Setup hint — two variants:
          1) needsEnableOnly: key already saved, only the toggle is off → one-click enable
          2) no key:                user hasn't configured anything yet → go to settings */}
      {showSetupHint && !isConfigured && needsEnableOnly && (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/4 p-4 space-y-2 animate-fade-in-up">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Zap className="size-3.5 text-primary" />
            {t("aiSearch.enableNowTitle")}
          </p>
          <p className="text-xs text-muted-foreground">{t("aiSearch.enableNowDesc")}</p>
          {enableError && (
            <p className="text-xs text-destructive">
              {t("aiSearch.enableNowFailed", { message: enableError })}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleEnableAI}
              disabled={enableAI.isPending}
              className="gap-1.5"
            >
              {enableAI.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Zap className="size-3" />
              )}
              {enableAI.isPending
                ? t("aiSearch.enableNowEnabling")
                : t("aiSearch.enableNowButton")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowSetupHint(false)}>
              {t("aiSearch.skip")}
            </Button>
          </div>
        </div>
      )}
      {showSetupHint && !isConfigured && !needsEnableOnly && (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/4 p-4 space-y-2 animate-fade-in-up">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-primary" />
            {t("aiSearch.notConfiguredTitle")}
          </p>
          <p className="text-xs text-muted-foreground">{t("aiSearch.notConfiguredDesc")}</p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => navigate("/settings")}>
              {t("aiSearch.configureNow")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowSetupHint(false)}>
              {t("aiSearch.skip")}
            </Button>
          </div>
        </div>
      )}

      {/* Streaming progress panel — replaces the old "AI thinking..." spinner */}
      {searching && currentStep && (
        <StreamingPanel
          step={currentStep}
          streamingText={streamingText}
          streamDone={streamDone}
        />
      )}

      {/* Error */}
      {error && !searching && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/4 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {result && !searching && (
        <div className="rounded-2xl glass p-4 space-y-4 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {resultMode === "basic" ? (
                <>🔍 {t("aiSearch.basicResultTitle")}</>
              ) : (
                <>✨ {t("aiSearch.resultTitle")}</>
              )}
            </h3>
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">
              {streamLatencyMs != null && resultMode === "ai"
                ? t("aiSearch.stepDone", { ms: streamLatencyMs })
                : `${result.local.length + result.marketplace.length}`}
            </span>
          </div>

          {/* Basic-mode upsell banner (small, non-blocking) */}
          {resultMode === "basic" && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-primary/25 bg-primary/4 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Info className="size-3 text-primary/70 shrink-0" />
                <span>{t("aiSearch.basicModeLabel")}</span>
              </p>
              <button
                type="button"
                onClick={needsEnableOnly ? handleEnableAI : () => navigate("/settings")}
                disabled={enableAI.isPending}
                className="text-[11px] font-medium text-primary hover:underline disabled:opacity-60"
              >
                {t("aiSearch.basicModeUpgrade")}
              </button>
            </div>
          )}

          {/* AI-only: streamed prose (typewriter) or structured explanation */}
          {resultMode === "ai" && (streamingText || result.explanation) && (
            <p className="text-xs text-muted-foreground italic leading-relaxed">
              {t("aiSearch.aiExplanation")}
              {streamingText || result.explanation}
            </p>
          )}

          {!hasAnyResults ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {resultMode === "basic"
                  ? t("aiSearch.basicNoResults")
                  : t("aiSearch.noResults")}
              </p>
              {resultMode === "basic" && (
                <p className="text-[11px] text-muted-foreground/70">
                  {t("aiSearch.basicNoResultsUpgrade")}
                </p>
              )}
            </div>
          ) : (
            <>
              {(scope === "all" || scope === "local") && (
                <Section
                  icon={<Package className="size-3 text-emerald-500" />}
                  title={t("aiSearch.groupLocal")}
                  count={result.local.length}
                  emptyText={t("aiSearch.groupLocalEmpty")}
                >
                  {result.local.map((rec, i) => (
                    <LocalRecCard
                      key={rec.skill_id}
                      rec={rec}
                      index={i}
                      onOpen={handleLocalClick}
                      actionLabel={t("aiSearch.actionOpen")}
                    />
                  ))}
                </Section>
              )}

              {/* Marketplace group: only shown in AI mode (basic search
                  cannot reach the marketplace) */}
              {resultMode === "ai" && (scope === "all" || scope === "marketplace") && (
                <Section
                  icon={<Download className="size-3 text-primary" />}
                  title={t("aiSearch.groupMarketplace")}
                  count={result.marketplace.length}
                  emptyText={t("aiSearch.groupMarketplaceEmpty")}
                >
                  {result.marketplace.map((rec, i) => (
                    <MarketRecCard
                      key={`${rec.skill_id}-${rec.marketplace_source}`}
                      rec={rec}
                      index={i + result.local.length}
                      onInstall={handleMarketplaceClick}
                      sourceFromText={t("aiSearch.sourceFrom")}
                      actionLabel={t("aiSearch.actionInstall")}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {installTarget && (
        <InstallToAgentsDialog
          skill={{
            name: installTarget.name,
            description: installTarget.description,
            repository: installTarget.repository,
            source: installTarget.marketplace_source ?? "marketplace",
          }}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}

// ============================================================
//  Streaming progress panel — shown while searching is in flight.
//  Renders:
//   - 4-step pipeline tracker (collect / scan / think / polish)
//   - When `thinking`, the AI's typewriter prose under the steps
// ============================================================
function StreamingPanel({
  step,
  streamingText,
  streamDone,
}: {
  step: Exclude<StepCode, null>;
  streamingText: string;
  streamDone: boolean;
}) {
  const { t } = useTranslation();
  const currentIdx = STEP_ORDER.indexOf(step);
  return (
    <div className="rounded-2xl glass p-4 space-y-3 animate-fade-in-up">
      {/* Indeterminate progress bar at the top */}
      <div className="relative h-0.5 w-full rounded-full bg-muted/30 overflow-hidden">
        <div
          className={cn(
            "absolute inset-y-0 w-1/3 rounded-full bg-linear-to-r from-transparent via-primary to-transparent",
            !streamDone && "animate-progress-indeterminate",
            streamDone && "bg-primary/40",
          )}
        />
      </div>

      {/* Step tracker */}
      <ol className="space-y-1.5">
        {STEP_ORDER.map((s, i) => {
          const state: "done" | "active" | "pending" =
            i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
          const Icon = stepIconFor(s);
          return (
            <li
              key={s}
              className={cn(
                "flex items-center gap-2 text-xs transition-colors",
                state === "done" && "text-muted-foreground",
                state === "active" && "text-foreground font-medium",
                state === "pending" && "text-muted-foreground/40",
              )}
            >
              {state === "done" ? (
                <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
              ) : state === "active" ? (
                <span className="relative shrink-0">
                  <Icon className="size-3.5 text-primary" />
                  <span className="absolute -inset-1 rounded-full bg-primary/20 animate-ping" />
                </span>
              ) : (
                <Circle className="size-3.5 shrink-0" />
              )}
              <span>{t(`aiSearch.step${capitalize(s)}`)}</span>
              {state === "active" && (
                <Loader2 className="size-3 ml-auto animate-spin text-primary/60" />
              )}
            </li>
          );
        })}
      </ol>

      {/* Typewriter prose — show whenever we have stream content,
          stays visible even after step advances to "polishing" */}
      {streamingText && (
        <div className="rounded-xl border border-primary/10 bg-primary/4 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-primary/80">
            <Brain className="size-3" />
            {t("aiSearch.thinkingLabel")}
          </div>
          <p className="text-xs text-foreground/90 leading-relaxed">
            {streamingText}
            {!streamDone && <span className="animate-caret text-primary/80" aria-hidden />}
          </p>
        </div>
      )}
    </div>
  );
}

function stepIconFor(step: Exclude<StepCode, null>) {
  switch (step) {
    case "collecting":
      return Package;
    case "scanning":
      return Search;
    case "thinking":
      return Brain;
    case "polishing":
      return Sparkles;
  }
}

function capitalize<T extends string>(s: T): Capitalize<T> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Basic local keyword filter used when AI is not configured.
 *
 * Splits the query into whitespace-delimited tokens (so "excel csv" matches
 * skills mentioning either), and scores each skill by where the match lands:
 *   - name match      → 1.0
 *   - description match → 0.6
 *   - id match        → 0.4
 * Skills with zero token matches are dropped. Results are sorted by score
 * desc, then by name asc. Capped at 20 to keep the panel scannable.
 */
function basicLocalFilter(
  rawQuery: string,
  skills: Skill[] | undefined,
): UnifiedRecommendation[] {
  if (!skills?.length) return [];
  const tokens = rawQuery
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return [];

  const scored = skills
    .map<UnifiedRecommendation | null>((s) => {
      const name = (s.name ?? "").toLowerCase();
      const desc = (s.description ?? "").toLowerCase();
      const id = (s.id ?? "").toLowerCase();
      let score = 0;
      let matched = 0;
      for (const token of tokens) {
        let tokenScore = 0;
        if (name.includes(token)) tokenScore = Math.max(tokenScore, 1.0);
        if (desc.includes(token)) tokenScore = Math.max(tokenScore, 0.6);
        if (id.includes(token)) tokenScore = Math.max(tokenScore, 0.4);
        if (tokenScore > 0) {
          matched++;
          score += tokenScore;
        }
      }
      if (matched === 0) return null;
      // Normalize so the maximum reachable score is ~1.0
      const normalized = Math.min(1, score / tokens.length);
      // Slight bonus for matching every token (full coverage)
      const finalScore = matched === tokens.length
        ? Math.min(1, normalized + 0.05)
        : normalized;
      return {
        skill_id: s.id,
        name: s.name,
        description: s.description ?? null,
        source_kind: "local",
        marketplace_source: null,
        repository: null,
        reason: s.description?.slice(0, 100) ?? "",
        score: finalScore,
      };
    })
    .filter((x): x is UnifiedRecommendation => x !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 20);

  return scored;
}

function Section({
  icon,
  title,
  count,
  emptyText,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 px-0.5">
        {icon}
        <span>{title}</span>
        <span className="tabular-nums">({count})</span>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic px-0.5">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">{children}</ul>
      )}
    </div>
  );
}

function LocalRecCard({
  rec,
  index,
  onOpen,
  actionLabel,
}: {
  rec: UnifiedRecommendation;
  index: number;
  onOpen: (rec: UnifiedRecommendation) => void;
  actionLabel: string;
}) {
  const scorePct = Math.round(rec.score * 100);
  return (
    <li
      className="rounded-xl border border-border/40 bg-background/40 px-3 py-2.5 hover:bg-background/60 transition-colors cursor-pointer group animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "forwards" }}
      onClick={() => onOpen(rec)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{rec.name}</span>
            <span className="text-[10px] tabular-nums rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5">
              {scorePct}%
            </span>
          </div>
          {rec.reason && (
            <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{rec.reason}</p>
          )}
        </div>
        <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 group-hover:underline shrink-0 mt-1">
          {actionLabel} →
        </span>
      </div>
    </li>
  );
}

function MarketRecCard({
  rec,
  index,
  onInstall,
  sourceFromText,
  actionLabel,
}: {
  rec: UnifiedRecommendation;
  index: number;
  onInstall: (rec: UnifiedRecommendation) => void;
  sourceFromText: string;
  actionLabel: string;
}) {
  const scorePct = Math.round(rec.score * 100);
  return (
    <li
      className="rounded-xl border border-border/40 bg-background/40 px-3 py-2.5 hover:bg-background/60 transition-colors group animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "forwards" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{rec.name}</span>
            <span className="text-[10px] tabular-nums rounded-full bg-primary/15 text-primary px-1.5 py-0.5">
              {scorePct}%
            </span>
            {rec.marketplace_source && (
              <span className="text-[10px] text-muted-foreground/70">
                {sourceFromText} {rec.marketplace_source}
              </span>
            )}
          </div>
          {rec.reason && (
            <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{rec.reason}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="default"
          className="shrink-0 gap-1.5"
          onClick={() => onInstall(rec)}
        >
          <Download className="size-3" />
          {actionLabel}
        </Button>
      </div>
    </li>
  );
}
