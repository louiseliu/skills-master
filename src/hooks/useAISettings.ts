import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke, Channel } from "@tauri-apps/api/core";

export interface AiConfigPublic {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  base_url: string | null;
  has_api_key: boolean;
}

export interface AiConfigInput {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  base_url: string | null;
}

export interface AiTestResult {
  ok: boolean;
  message: string;
  latency_ms: number | null;
}

export interface AiRecommendation {
  skill_id: string;
  reason: string;
  score: number;
}

export interface AiSearchResponse {
  recommendations: AiRecommendation[];
  explanation: string;
}

export interface AiSkillCandidate {
  id: string;
  name: string;
  description: string | null;
}

export type UnifiedScope = "all" | "local" | "marketplace";

export interface UnifiedRecommendation {
  skill_id: string;
  name: string;
  description: string | null;
  source_kind: "local" | "marketplace";
  marketplace_source: string | null;
  repository: string | null;
  reason: string;
  score: number;
}

export interface UnifiedSearchResponse {
  local: UnifiedRecommendation[];
  marketplace: UnifiedRecommendation[];
  explanation: string;
}

export interface UnifiedLocalCandidate {
  id: string;
  name: string;
  description: string | null;
}

export interface AiExplainResponse {
  summary: string;
  purpose: string;
  when_to_use: string[];
  key_capabilities: string[];
  good_for: string;
  caveats: string | null;
}

export const PROVIDER_PRESETS: Record<
  string,
  { baseUrl: string; defaultModel: string; signupUrl: string; needsKey: boolean }
> = {
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    signupUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    needsKey: true,
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    signupUrl: "https://platform.deepseek.com/api_keys",
    needsKey: true,
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-turbo",
    signupUrl: "https://bailian.console.aliyun.com/?tab=model",
    needsKey: true,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    signupUrl: "https://platform.openai.com/api-keys",
    needsKey: true,
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    signupUrl: "https://ollama.com/download",
    needsKey: false,
  },
  custom: {
    baseUrl: "",
    defaultModel: "",
    signupUrl: "",
    needsKey: true,
  },
};

export const PROVIDER_ORDER = ["glm", "deepseek", "qwen", "openai", "ollama", "custom"] as const;

const QK_AI_CONFIG = ["ai-config"];

export function useAIConfig() {
  return useQuery<AiConfigPublic>({
    queryKey: QK_AI_CONFIG,
    queryFn: () => invoke<AiConfigPublic>("ai_get_config"),
  });
}

export function useSaveAIConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: AiConfigInput) =>
      invoke<void>("ai_save_config", { config }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK_AI_CONFIG }),
  });
}

export function useSetAPIKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => invoke<void>("ai_set_api_key", { apiKey }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK_AI_CONFIG }),
  });
}

export function useClearAPIKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<void>("ai_clear_api_key"),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK_AI_CONFIG }),
  });
}

/**
 * One-click enable for AI features.
 *
 * Used by surfaces (dashboard search bar, skill explainer) that detect
 * an API key is already set but the AI toggle is off. Saves the current
 * provider/model/base_url unchanged, just flips `enabled` to true.
 */
export function useEnableAI() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (current: AiConfigPublic) => {
      const config: AiConfigInput = {
        enabled: true,
        provider: current.provider,
        model: current.model,
        base_url: current.base_url,
      };
      await invoke<void>("ai_save_config", { config });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK_AI_CONFIG }),
  });
}

export async function testAIConnection(): Promise<AiTestResult> {
  return invoke<AiTestResult>("ai_test_connection");
}

export async function aiSearchSkills(
  query: string,
  candidates: AiSkillCandidate[],
): Promise<AiSearchResponse> {
  return invoke<AiSearchResponse>("ai_search_skills", { query, candidates });
}

export async function aiSearchUnified(
  query: string,
  scope: UnifiedScope,
  localCandidates: UnifiedLocalCandidate[],
): Promise<UnifiedSearchResponse> {
  return invoke<UnifiedSearchResponse>("ai_search_unified", {
    query,
    scope,
    localCandidates,
  });
}

export async function aiExplainSkill(
  skillName: string,
  content: string,
): Promise<AiExplainResponse> {
  return invoke<AiExplainResponse>("ai_explain_skill", {
    skillName,
    content,
  });
}

// ============================================================
//  Streaming explanation (typewriter effect)
//
//  Runs in parallel with the structured search/explain calls.
//  Backend pushes incremental events through a Tauri Channel
//  so the UI can typewriter the AI's reasoning while heavier
//  JSON work happens in the background.
// ============================================================

export type AiStreamEvent =
  | { kind: "step"; code: string }
  | { kind: "delta"; text: string }
  | { kind: "done"; full_text: string; latency_ms: number }
  | { kind: "error"; message: string };

export interface AiStreamHandlers {
  onStep?: (code: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (full: string, latencyMs: number) => void;
  onError?: (message: string) => void;
}

function bindChannel(
  channel: Channel<AiStreamEvent>,
  handlers: AiStreamHandlers,
): void {
  channel.onmessage = (msg) => {
    switch (msg.kind) {
      case "step":
        handlers.onStep?.(msg.code);
        break;
      case "delta":
        handlers.onDelta?.(msg.text);
        break;
      case "done":
        handlers.onDone?.(msg.full_text, msg.latency_ms);
        break;
      case "error":
        handlers.onError?.(msg.message);
        break;
    }
  };
}

/**
 * Streams a short natural-language "thinking out loud" explanation for an
 * AI search query. Resolves once the stream terminates (success or error).
 */
export async function aiStreamSearchExplanation(
  query: string,
  scope: UnifiedScope,
  localCount: number,
  handlers: AiStreamHandlers,
): Promise<void> {
  const onEvent = new Channel<AiStreamEvent>();
  bindChannel(onEvent, handlers);
  await invoke<void>("ai_stream_search_explanation", {
    query,
    scope,
    localCount,
    onEvent,
  });
}

/**
 * Streams a short prose summary for a skill (used by AISkillExplainer
 * to fill the gap while the structured explain call is in flight).
 */
export async function aiStreamExplainSummary(
  skillName: string,
  content: string,
  handlers: AiStreamHandlers,
): Promise<void> {
  const onEvent = new Channel<AiStreamEvent>();
  bindChannel(onEvent, handlers);
  await invoke<void>("ai_stream_explain_summary", {
    skillName,
    content,
    onEvent,
  });
}
