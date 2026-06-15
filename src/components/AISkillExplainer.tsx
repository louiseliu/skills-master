// ============================================================
//  AI Skill Explainer
//  Tap-to-summon AI summary of a skill (BYOK).
//  - Caches result via React Query (1h staleTime), keyed by `cacheKey`.
//  - Triggered manually so we never auto-consume the user's quota.
//  - Shared between SkillsManager and Marketplace.
//
//  UX: when triggered, runs TWO LLM calls in parallel
//      1) `ai_stream_explain_summary` — short prose, typewriter
//      2) `ai_explain_skill`          — structured JSON
//      The typewriter prose masks the latency of (2); structured
//      cards fade in once (2) finishes.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Zap,
  Brain,
  BookOpen,
  Wand2,
  CheckCircle2,
  Circle,
} from "lucide-react";
import {
  aiExplainSkill,
  aiStreamExplainSummary,
  useAIConfig,
  useEnableAI,
  type AiExplainResponse,
} from "@/hooks/useAISettings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AISkillExplainerProps {
  /** Stable identity used for React Query cache + reset trigger */
  cacheKey: string;
  /** Display name of the skill (passed to the LLM) */
  skillName: string;
  /** Full SKILL.md content (passed to the LLM) */
  content: string;
  /** While true, the trigger shows a "loading content" hint */
  contentLoading: boolean;
  /** Optional override of the wrapper className (rarely needed) */
  className?: string;
}

type ExplainStep = "reading" | "thinking" | "polishing" | null;
const EXPLAIN_STEPS: Exclude<ExplainStep, null>[] = [
  "reading",
  "thinking",
  "polishing",
];

export default function AISkillExplainer({
  cacheKey,
  skillName,
  content,
  contentLoading,
  className,
}: AISkillExplainerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: aiConfig } = useAIConfig();
  const enableAI = useEnableAI();
  const [requested, setRequested] = useState(false);

  // Streaming state — runs in parallel with the structured query
  const [streamText, setStreamText] = useState("");
  const [streamDone, setStreamDone] = useState(false);
  const [streamStep, setStreamStep] = useState<ExplainStep>(null);
  const runIdRef = useRef(0);

  const hasApiKey = !!aiConfig?.has_api_key;
  const isEnabled = !!aiConfig?.enabled;
  const isConfigured = hasApiKey && isEnabled;
  const needsEnableOnly = hasApiKey && !isEnabled;
  const contentReady = !contentLoading && content.trim().length > 0;

  const explainQuery = useQuery<AiExplainResponse, Error>({
    queryKey: ["ai-explain-skill", cacheKey],
    queryFn: () => aiExplainSkill(skillName, content),
    enabled: requested && contentReady && isConfigured,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  // Reset request flag + stream state when switching skill
  useEffect(() => {
    runIdRef.current++;
    setRequested(false);
    setStreamText("");
    setStreamDone(false);
    setStreamStep(null);
  }, [cacheKey]);

  // Whenever a fetch starts, kick off the parallel streaming summary
  const isFetching = explainQuery.isFetching;
  useEffect(() => {
    if (!isFetching) return;
    if (!isConfigured) return;
    if (!contentReady) return;
    const myRun = ++runIdRef.current;
    setStreamText("");
    setStreamDone(false);
    setStreamStep("reading");

    // Quick visual "reading" beat, then defer to real events
    const readingTimer = setTimeout(() => {
      if (runIdRef.current === myRun) setStreamStep("thinking");
    }, 250);

    aiStreamExplainSummary(skillName, content, {
      onStep: (code) => {
        if (runIdRef.current !== myRun) return;
        if (code === "thinking") setStreamStep("thinking");
      },
      onDelta: (text) => {
        if (runIdRef.current !== myRun) return;
        setStreamText((prev) => prev + text);
      },
      onDone: () => {
        if (runIdRef.current !== myRun) return;
        setStreamDone(true);
        setStreamStep("polishing");
      },
      onError: () => {
        // Structured query is authoritative — silently swallow stream errors.
      },
    }).catch(() => {
      /* see onError */
    });

    return () => {
      clearTimeout(readingTimer);
    };
  }, [isFetching, isConfigured, contentReady, skillName, content]);

  const data = explainQuery.data;
  const error = explainQuery.error;

  const trigger = () => {
    if (!isConfigured) return;
    setRequested(true);
    if (data) explainQuery.refetch();
  };

  async function handleEnableAI() {
    if (!aiConfig) return;
    try {
      await enableAI.mutateAsync(aiConfig);
    } catch {
      // surfaced through global toast / next interaction; explainer stays in current state
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-primary/15 bg-linear-to-br from-primary/5 via-primary/2 to-transparent p-3 space-y-2 relative overflow-hidden",
        className,
      )}
    >
      {/* Decorative orb */}
      <div
        className="pointer-events-none absolute -top-8 -right-8 size-24 rounded-full bg-linear-to-br from-primary/15 to-transparent blur-2xl"
        aria-hidden="true"
      />

      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            {t("skills.aiExplainTitle")}
          </span>
        </div>
        {!data && !isFetching && (
          isConfigured ? (
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1.5 text-xs"
              onClick={trigger}
              disabled={!contentReady}
              title={
                !contentReady
                  ? t("skills.aiExplainContentLoading")
                  : t("skills.aiExplainTooltip")
              }
            >
              <Sparkles className="size-3" />
              {!contentReady
                ? t("skills.aiExplainContentLoading")
                : t("skills.aiExplainAction")}
            </Button>
          ) : needsEnableOnly ? (
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1.5 text-xs"
              onClick={handleEnableAI}
              disabled={enableAI.isPending}
              title={t("skills.aiExplainNeedsEnableHint")}
            >
              {enableAI.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Zap className="size-3" />
              )}
              {enableAI.isPending
                ? t("skills.aiExplainEnabling")
                : t("skills.aiExplainEnableNow")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => navigate("/settings")}
              title={t("skills.aiExplainNotConfigured")}
            >
              <Sparkles className="size-3" />
              {t("skills.aiExplainConfigure")}
            </Button>
          )
        )}
      </div>

      {!data && !isFetching && !error && (
        <p className="relative text-[11px] text-muted-foreground/80 leading-relaxed">
          {isConfigured
            ? t("skills.aiExplainHint")
            : needsEnableOnly
              ? t("skills.aiExplainNeedsEnableHint")
              : t("skills.aiExplainNotConfiguredHint")}
        </p>
      )}

      {isFetching && (
        <ExplainStreamingPanel
          step={streamStep}
          streamText={streamText}
          streamDone={streamDone}
        />
      )}

      {error && (
        <div className="relative space-y-1.5">
          <p className="text-xs text-destructive">{error.message}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={trigger}
          >
            <RefreshCw className="size-3" />
            {t("skills.aiExplainRetry")}
          </Button>
        </div>
      )}

      {data && (
        <div className="relative space-y-2.5 animate-fade-in-up">
          {data.summary && (
            <p className="text-sm font-medium leading-snug text-foreground">
              {data.summary}
            </p>
          )}

          {data.purpose && (
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              {data.purpose}
            </p>
          )}

          {data.when_to_use.length > 0 && (
            <ExplainSection label={t("skills.aiExplainWhenToUse")}>
              <ul className="flex flex-wrap gap-1">
                {data.when_to_use.map((item, i) => (
                  <li
                    key={i}
                    className="rounded-full bg-primary/8 text-primary border border-primary/15 px-2 py-0.5 text-[11px] animate-fade-in-up opacity-0"
                    style={{ animationDelay: `${i * 50}ms`, animationFillMode: "forwards" }}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </ExplainSection>
          )}

          {data.key_capabilities.length > 0 && (
            <ExplainSection label={t("skills.aiExplainCapabilities")}>
              <ul className="space-y-0.5 text-[11.5px] text-foreground/80">
                {data.key_capabilities.map((item, i) => (
                  <li
                    key={i}
                    className="flex gap-1.5 animate-fade-in-up opacity-0"
                    style={{ animationDelay: `${150 + i * 60}ms`, animationFillMode: "forwards" }}
                  >
                    <span className="text-primary/60 shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </ExplainSection>
          )}

          {data.good_for && (
            <ExplainSection label={t("skills.aiExplainGoodFor")}>
              <p className="text-[11.5px] text-foreground/80 leading-relaxed">
                {data.good_for}
              </p>
            </ExplainSection>
          )}

          {data.caveats && (
            <ExplainSection label={t("skills.aiExplainCaveats")} tone="warn">
              <p className="text-[11.5px] text-amber-700 dark:text-amber-300 leading-relaxed">
                {data.caveats}
              </p>
            </ExplainSection>
          )}

          {/* Footer — refresh + meta */}
          <div className="flex items-center justify-between pt-1.5 border-t border-black/4 dark:border-white/4">
            <span className="text-[10px] text-muted-foreground/50">
              {t("skills.aiExplainPoweredBy", {
                model: aiConfig?.model ?? "AI",
              })}
            </span>
            <button
              type="button"
              onClick={trigger}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
              title={t("skills.aiExplainRegenerate")}
            >
              <RefreshCw className="size-2.5" />
              {t("skills.aiExplainRegenerate")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExplainStreamingPanel({
  step,
  streamText,
  streamDone,
}: {
  step: ExplainStep;
  streamText: string;
  streamDone: boolean;
}) {
  const { t } = useTranslation();
  const currentIdx = step ? EXPLAIN_STEPS.indexOf(step) : 0;
  return (
    <div className="relative space-y-2">
      {/* Indeterminate progress bar */}
      <div className="h-0.5 w-full rounded-full bg-muted/30 overflow-hidden">
        <div
          className={cn(
            "h-full w-1/3 rounded-full bg-linear-to-r from-transparent via-primary to-transparent",
            !streamDone && "animate-progress-indeterminate",
            streamDone && "bg-primary/40",
          )}
        />
      </div>

      <ol className="flex items-center gap-2 text-[10px] text-muted-foreground/80">
        {EXPLAIN_STEPS.map((s, i) => {
          const state: "done" | "active" | "pending" =
            i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
          const Icon = explainStepIcon(s);
          return (
            <li
              key={s}
              className={cn(
                "flex items-center gap-1 transition-colors",
                state === "done" && "text-muted-foreground/60",
                state === "active" && "text-foreground font-medium",
                state === "pending" && "text-muted-foreground/30",
              )}
            >
              {state === "done" ? (
                <CheckCircle2 className="size-2.5 text-emerald-500" />
              ) : state === "active" ? (
                <Icon className="size-2.5 text-primary" />
              ) : (
                <Circle className="size-2.5" />
              )}
              <span>{t(`skills.aiExplainStep${capitalize(s)}`)}</span>
              {i < EXPLAIN_STEPS.length - 1 && (
                <span className="text-muted-foreground/30">›</span>
              )}
            </li>
          );
        })}
      </ol>

      {streamText && (
        <div className="rounded-lg border border-primary/10 bg-primary/4 p-2.5 space-y-1">
          <div className="flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider text-primary/80">
            <Brain className="size-2.5" />
            {t("skills.aiExplainStreamLabel")}
          </div>
          <p className="text-[12px] text-foreground/90 leading-relaxed">
            {streamText}
            {!streamDone && <span className="animate-caret text-primary/80" aria-hidden />}
          </p>
        </div>
      )}
    </div>
  );
}

function explainStepIcon(step: Exclude<ExplainStep, null>) {
  switch (step) {
    case "reading":
      return BookOpen;
    case "thinking":
      return Brain;
    case "polishing":
      return Wand2;
  }
}

function capitalize<T extends string>(s: T): Capitalize<T> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<T>;
}

function ExplainSection({
  label,
  tone = "default",
  children,
}: {
  label: string;
  tone?: "default" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h4
        className={cn(
          "text-[9.5px] font-semibold uppercase tracking-wider",
          tone === "warn"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground/60",
        )}
      >
        {label}
      </h4>
      {children}
    </div>
  );
}
