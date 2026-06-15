/**
 * SkillTagsEditor — in-detail editor for a single skill's tag list.
 *
 * Layout:
 *   Section title  +  small "custom / default" badge  +  optional "restore" link
 *   ── chip row (X to remove each)
 *   ── inline input  (Enter / Add button to append)
 *   ── AI suggestion row  (button → candidate chips → tap to accept)
 *
 * Persistence model:
 *   The backend stores a USER OVERRIDE keyed by `skill.id`. The override is
 *   either absent (skill falls back to SKILL.md frontmatter tags) or a full
 *   replacement list. The "current_default" we send to add/remove tells the
 *   backend "seed the override from this list" so the user's first edit is
 *   additive instead of nuking the frontmatter defaults.
 *
 * AI behaviour:
 *   AI returns candidates; we never auto-write. Each candidate is a clickable
 *   chip — tap to add a single tag, or hit "Accept all" to merge the entire
 *   set. This keeps the user in control and avoids surprise pollution.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag as TagIcon, X, Plus, Sparkles, Loader2, RotateCcw, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Skill } from "@/hooks/useSkills";
import {
  useAddSkillTag,
  useAiSuggestSkillTags,
  useClearSkillTagOverride,
  useRemoveSkillTag,
  useSetSkillTags,
  useSkillTagOverrides,
} from "@/hooks/useSkillTags";
import { useAIConfig } from "@/hooks/useAISettings";

interface Props {
  skill: Skill;
  /**
   * Bumping this value from the parent (e.g. detail-header "✨ AI 打标签" CTA)
   * counts as the user's explicit "generate now" click — we scroll the editor
   * into view and immediately fire the same code path as the in-editor
   * suggest button. This is NOT a passive auto-trigger: it only happens when
   * the user clicks the header button, never on tab switch / skill switch.
   *
   * IMPORTANT: use `null` (or omit) for the idle/initial value, never 0.
   * Falsy guard below treats 0 as a real trigger, and we don't want the
   * "AI 思考中 the moment any detail panel opens" footgun to come back.
   *
   * Why a Date.now() integer? Each new value forces a re-fire even if the
   * user closes candidates and clicks the header CTA again immediately.
   * Booleans can't distinguish two consecutive identical intents.
   */
  runSuggestKey?: number | null;
}

export function SkillTagsEditor({ skill, runSuggestKey }: Props) {
  const { t } = useTranslation();
  const { data: overrides } = useSkillTagOverrides();
  const setTags = useSetSkillTags();
  const addTag = useAddSkillTag();
  const removeTag = useRemoveSkillTag();
  const clearOverride = useClearSkillTagOverride();
  const suggest = useAiSuggestSkillTags(skill.id);

  // Detect override presence so we can show a "custom vs from SKILL.md" badge
  // and the "restore default" affordance.
  const hasOverride = useMemo(
    () => Boolean(overrides && Object.prototype.hasOwnProperty.call(overrides, skill.id)),
    [overrides, skill.id],
  );

  // Defensive de-dup at the render boundary. The backend already normalizes +
  // de-dups, but a stale store or hand-edited skill-tags.json should never
  // produce visual duplicates in the chip row.
  const displayTags = useMemo(() => Array.from(new Set(skill.tags ?? [])), [skill.tags]);

  const [draft, setDraft] = useState("");
  const [aiCandidates, setAiCandidates] = useState<string[] | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Gate for whether the parent's "✨ AI 打标签" header button can fire us
  // — when AI isn't configured the header button is hidden, so we silently
  // skip too. The full "enable AI" / "go to settings" affordance lives in
  // the dashboard search bar, not here.
  const aiSettings = useAIConfig();
  const cfg = aiSettings.data;
  const isAIReady = !!cfg && cfg.enabled && cfg.has_api_key;

  function handleAdd() {
    const value = draft.trim();
    if (!value) return;
    addTag.mutate(
      { skillId: skill.id, tag: value, currentDefault: skill.tags },
      {
        onSuccess: () => setDraft(""),
      },
    );
  }

  function handleRemove(tag: string) {
    removeTag.mutate({
      skillId: skill.id,
      tag,
      currentDefault: skill.tags,
    });
  }

  function handleAcceptCandidate(tag: string) {
    addTag.mutate(
      { skillId: skill.id, tag, currentDefault: skill.tags },
      {
        onSuccess: () => {
          setAiCandidates((prev) => (prev ? prev.filter((x) => x !== tag) : prev));
        },
      },
    );
  }

  function handleAcceptAll() {
    if (!aiCandidates || aiCandidates.length === 0) return;
    const merged = Array.from(new Set([...skill.tags, ...aiCandidates]));
    setTags.mutate(
      { skillId: skill.id, tags: merged },
      {
        onSuccess: () => setAiCandidates(null),
      },
    );
  }

  // Single source of truth for "run AI suggest now". Both the in-editor
  // button click and the header quick-action go through this. We dedupe
  // re-entry via `suggest.isPending` and log enough breadcrumbs to debug
  // the dreaded "AI 思考中…" hang report.
  function handleSuggest() {
    if (suggest.isPending) return; // belt-and-suspenders against double-fire
    setAiError(null);
    const startedAt = performance.now();
    // eslint-disable-next-line no-console
    console.log("[ai-tags] start", {
      skillId: skill.id,
      name: skill.name,
      existingTags: skill.tags.length,
    });
    suggest.mutate(
      {
        skillName: skill.name,
        description: skill.description,
        existingTags: skill.tags,
      },
      {
        onSuccess: (tags) => {
          const elapsed = Math.round(performance.now() - startedAt);
          // eslint-disable-next-line no-console
          console.log("[ai-tags] success", { skillId: skill.id, ms: elapsed, tags });
          // Filter out tags the skill already has + dedup candidates themselves
          // so the user never sees two visually-identical chips.
          const owned = new Set(skill.tags);
          const fresh = Array.from(new Set(tags)).filter((t) => !owned.has(t));
          setAiCandidates(fresh);
        },
        onError: (err) => {
          const elapsed = Math.round(performance.now() - startedAt);
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error("[ai-tags] error", { skillId: skill.id, ms: elapsed, msg });
          setAiError(msg);
        },
      },
    );
  }

  function handleClearOverride() {
    clearOverride.mutate(skill.id);
  }

  // === Quick action from parent ===
  // Parent (SkillDetail header) bumps `runSuggestKey` to imperatively request
  // an AI suggest run. We treat it exactly the same as an in-editor click:
  // scroll ourselves into view so the spinner is visible, then call the
  // shared `handleSuggest()` code path.
  //
  // GUARDS (in order of importance — each prevents a specific past bug):
  //   1. `runSuggestKey == null` → idle, never auto-fire on mount/skill-switch.
  //      Using `==` catches both `null` and `undefined`. (Bug we fixed: parent
  //      passed `0` as initial state, which slipped through the old `=== undefined`
  //      check and made every detail panel open immediately call AI.)
  //   2. `lastHandledKeyRef.current === runSuggestKey` → de-dupes React
  //      StrictMode double-invocation in dev and prevents the same key value
  //      from re-firing on unrelated re-renders (e.g. theme switch).
  //   3. `!isAIReady` → silent skip; the header button is hidden in this case
  //      so the only path here is a stale prop from a previous mount.
  const lastHandledKeyRef = useRef<number | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (runSuggestKey == null) return;
    if (lastHandledKeyRef.current === runSuggestKey) return;
    lastHandledKeyRef.current = runSuggestKey;
    if (!isAIReady) return;

    requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    handleSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSuggestKey, isAIReady]);

  return (
    <section ref={sectionRef} className="space-y-2 scroll-mt-14">
      {/* Header — title, badge, restore-default link */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <TagIcon className="size-3.5 text-primary/70" />
          <span>{t("skills.tagsTitle")}</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-px text-[9px] font-medium",
              hasOverride
                ? "bg-primary/10 text-primary"
                : "bg-muted/40 text-muted-foreground",
            )}
          >
            {hasOverride ? t("skills.tagsCustomBadge") : t("skills.tagsDefaultBadge")}
          </span>
        </div>
        {hasOverride && (
          <button
            type="button"
            onClick={handleClearOverride}
            disabled={clearOverride.isPending}
            title={t("skills.tagsClearOverrideHint")}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RotateCcw className="size-3" />
            {t("skills.tagsClearOverride")}
          </button>
        )}
      </div>

      {/* Chip row */}
      <div className="flex flex-wrap gap-1 min-w-0">
        {displayTags.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60 italic">
            {t("skills.tagsEmptyCloud")}
          </p>
        ) : (
          displayTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium max-w-[180px]"
            >
              <span className="truncate">{tag}</span>
              <button
                type="button"
                onClick={() => handleRemove(tag)}
                disabled={removeTag.isPending}
                aria-label={t("skills.tagsRemove")}
                className="rounded-full p-0.5 hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                <X className="size-2.5" />
              </button>
            </span>
          ))
        )}
      </div>

      {/* Input row */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={t("skills.tagsAddPlaceholder")}
          className="flex-1 min-w-0 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={handleAdd}
          disabled={!draft.trim() || addTag.isPending}
          className="gap-1 shrink-0"
        >
          <Plus className="size-3" />
          {t("skills.tagsAdd")}
        </Button>
      </div>

      {/* AI suggestion area — only renders when there's something to show
          (loading, error, candidates, or "all suggested already exist"
          confirmation). Entry point lives in the detail header's "✨ AI
          打标签" button, NOT here — keeps the editor clean by default. */}
      {(suggest.isPending || aiError || aiCandidates !== null) && (
        <div className="rounded-xl border border-dashed border-primary/20 bg-primary/3 p-2.5 space-y-2">
          {/* Header strip: title + spinner. No CTA button — user enters via
              the detail-page header to avoid two competing buttons. */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {suggest.isPending ? (
              <Loader2 className="size-3 animate-spin text-primary/70" />
            ) : (
              <Sparkles className="size-3 text-primary/70" />
            )}
            <span>
              {suggest.isPending
                ? t("skills.tagsAiSuggesting")
                : t("skills.tagsAiCandidates")}
            </span>
          </div>

          {aiError && (
            <p className="text-[10px] text-destructive">
              {t("skills.tagsAiSuggestFailed", { message: aiError })}
            </p>
          )}

          {aiCandidates && aiCandidates.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1 min-w-0">
                {aiCandidates.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAcceptCandidate(tag)}
                    disabled={addTag.isPending}
                    className="inline-flex items-center gap-1 rounded-full bg-background/80 border border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground px-2 py-0.5 text-[11px] font-medium transition-colors max-w-[180px]"
                  >
                    <Plus className="size-2.5 shrink-0" />
                    <span className="truncate">{tag}</span>
                  </button>
                ))}
              </div>
              {/* Bulk-action row — primary "accept all" (filled) + secondary
                  "dismiss" (ghost). Small icons + count badge make the affordance
                  obvious; the prior text-only buttons were too easy to miss. */}
              <div className="flex items-center gap-1.5 pt-0.5">
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleAcceptAll}
                  disabled={setTags.isPending}
                  className="h-7 gap-1.5 px-2.5"
                >
                  {setTags.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Check className="size-3" />
                  )}
                  <span>{t("skills.tagsAiAcceptAll")}</span>
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[16px] rounded-full bg-primary-foreground/20 text-primary-foreground px-1 text-[10px] font-bold tabular-nums">
                    {aiCandidates.length}
                  </span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAiCandidates(null)}
                  className="h-7 gap-1 px-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                  <span>{t("skills.tagsAiDismiss")}</span>
                </Button>
              </div>
            </div>
          )}

          {aiCandidates && aiCandidates.length === 0 && !suggest.isPending && (
            <p className="text-[10px] text-muted-foreground/60 italic">
              {/* AI ran but every suggested tag is already present */}
              ✓ {t("skills.tagsSaved")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
