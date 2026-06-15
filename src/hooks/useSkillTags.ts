/**
 * Skill tags — user-managed labels stored as an *override layer* on top of
 * the SKILL.md frontmatter defaults. The backend resolves the effective
 * `tags` field during scan (override wins; falling back to frontmatter).
 *
 * This hook surface gives the frontend three capabilities:
 *  1. Read the override map (so the UI can render a "custom vs default" badge)
 *  2. Mutate one skill's tags (set / add / remove / clear)
 *  3. Ask AI to propose 3-5 candidate tags from name + description + body
 *
 * After any mutation we invalidate both `skill-tag-overrides` and `skills`
 * (the main scan) so the OverviewPane "tag cloud" updates in real time.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export type SkillTagOverrideMap = Record<string, string[]>;

export interface AiSuggestTagsResponse {
  tags: string[];
}

const Q_OVERRIDES = ["skill-tag-overrides"] as const;

/** All user-managed tag overrides. Empty map if file missing / unset. */
export function useSkillTagOverrides() {
  return useQuery({
    queryKey: Q_OVERRIDES,
    queryFn: async (): Promise<SkillTagOverrideMap> => {
      return await invoke<SkillTagOverrideMap>("list_skill_tag_overrides");
    },
    staleTime: 60_000,
  });
}

/**
 * Replace the entire tag list for a skill. Pass `[]` to clear the override
 * (the skill will revert to its frontmatter default).
 */
export function useSetSkillTags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ skillId, tags }: { skillId: string; tags: string[] }) => {
      return await invoke<string[]>("set_skill_tags", { skillId, tags });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: Q_OVERRIDES });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/**
 * Append one tag. `currentDefault` is the *current effective* tag list (the
 * `Skill.tags` field returned by the scan). Sending it lets the backend seed
 * the new override from the visible state so the user's "add" is additive,
 * not destructive.
 */
export function useAddSkillTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      skillId,
      tag,
      currentDefault,
    }: {
      skillId: string;
      tag: string;
      currentDefault: string[];
    }) => {
      return await invoke<string[]>("add_skill_tag", {
        skillId,
        tag,
        currentDefault,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: Q_OVERRIDES });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/** Remove one tag (same seeding contract as add). */
export function useRemoveSkillTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      skillId,
      tag,
      currentDefault,
    }: {
      skillId: string;
      tag: string;
      currentDefault: string[];
    }) => {
      return await invoke<string[]>("remove_skill_tag", {
        skillId,
        tag,
        currentDefault,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: Q_OVERRIDES });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/** Drop the override entirely → revert to SKILL.md frontmatter defaults. */
export function useClearSkillTagOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (skillId: string) => {
      await invoke<void>("clear_skill_tag_override", { skillId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: Q_OVERRIDES });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/**
 * Stable mutation-key factory for AI tag suggestions, scoped per-skill so the
 * parent <SkillDetail> can ask `useIsMutating({ mutationKey: aiSuggestSkillTagsKey(skill.id) })`
 * to find out whether *this specific skill's* editor is in-flight, without
 * needing a callback up from the editor. This is what powers the header
 * "AI 思考中…" spinner staying in sync with the editor button.
 */
export function aiSuggestSkillTagsKey(skillId: string): readonly unknown[] {
  return ["ai-suggest-skill-tags", skillId] as const;
}

/**
 * Ask the AI to propose 3-5 candidate tags from FRONTMATTER ONLY
 * (name + description + existing tags/keywords). We deliberately don't pass
 * the SKILL.md body — frontmatter is dense, curated metadata and skipping
 * the body makes the call ~10x faster without measurable quality loss.
 *
 * We never persist the result here; the caller shows candidates and lets
 * the user pick which to accept (avoids AI silently polluting the tag space).
 *
 * Pass `skillId` so the mutationKey is per-skill — that way `useIsMutating`
 * elsewhere in the tree (e.g. the detail header button) can mirror this
 * mutation's pending state for the correct skill only.
 */
export function useAiSuggestSkillTags(skillId: string) {
  return useMutation({
    mutationKey: aiSuggestSkillTagsKey(skillId),
    mutationFn: async ({
      skillName,
      description,
      existingTags,
    }: {
      skillName: string;
      description?: string | null;
      /** Current tags on the skill — used as style examples + negative list. */
      existingTags?: string[];
    }): Promise<string[]> => {
      const resp = await invoke<AiSuggestTagsResponse>("ai_suggest_skill_tags", {
        skillName,
        description: description ?? null,
        existingTags: existingTags ?? [],
      });
      return resp.tags;
    },
  });
}
