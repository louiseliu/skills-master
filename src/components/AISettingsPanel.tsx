import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Eye, EyeOff, ChevronDown, ChevronUp, ExternalLink, Check, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import {
  useAIConfig,
  useSaveAIConfig,
  useSetAPIKey,
  useClearAPIKey,
  testAIConnection,
  PROVIDER_PRESETS,
  PROVIDER_ORDER,
  type AiTestResult,
} from "@/hooks/useAISettings";
import { cn, nativeSelectClass } from "@/lib/utils";

export default function AISettingsPanel() {
  const { t } = useTranslation();
  const { data: config, isLoading } = useAIConfig();
  const saveConfig = useSaveAIConfig();
  const setApiKey = useSetAPIKey();
  const clearApiKey = useClearAPIKey();

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<string>("glm");
  const [model, setModel] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [apiKeyDraft, setApiKeyDraft] = useState<string>("");
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [keyCleared, setKeyCleared] = useState(false);
  const [savedRecently, setSavedRecently] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);

  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setProvider(config.provider ?? "glm");
    setModel(config.model ?? "");
    setBaseUrl(config.base_url ?? "");
  }, [config]);

  const presetSignupUrl = useMemo(
    () => PROVIDER_PRESETS[provider]?.signupUrl ?? "",
    [provider],
  );

  function handleProviderChange(next: string) {
    setProvider(next);
    const preset = PROVIDER_PRESETS[next];
    if (preset) {
      if (preset.baseUrl) setBaseUrl(preset.baseUrl);
      if (preset.defaultModel) setModel(preset.defaultModel);
    }
    setTestResult(null);
  }

  async function handleSaveKey() {
    if (!apiKeyDraft.trim()) return;
    await setApiKey.mutateAsync(apiKeyDraft.trim());
    // Auto-enable AI once the user has bothered to set up an API key.
    // Otherwise enabled stays false and other surfaces still show "Configure AI".
    if (!enabled) {
      await saveConfig.mutateAsync({
        enabled: true,
        provider,
        model: model.trim() || null,
        base_url: baseUrl.trim() || null,
      });
      setEnabled(true);
    }
    setApiKeyDraft("");
    setKeySaved(true);
    setTestResult(null);
    setTimeout(() => setKeySaved(false), 2000);
  }

  async function handleClearKey() {
    await clearApiKey.mutateAsync();
    setApiKeyDraft("");
    setTestResult(null);
    setKeyCleared(true);
    setTimeout(() => setKeyCleared(false), 2000);
  }

  async function handleSave() {
    await saveConfig.mutateAsync({
      enabled,
      provider,
      model: model.trim() || null,
      base_url: baseUrl.trim() || null,
    });
    setSavedRecently(true);
    setTimeout(() => setSavedRecently(false), 2000);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAIConnection();
      setTestResult(result);
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        latency_ms: null,
      });
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-2xl glass p-5 animate-pulse space-y-3">
        <div className="h-5 w-32 rounded bg-muted/40" />
        <div className="h-4 w-64 rounded bg-muted/30" />
      </div>
    );
  }

  const hasApiKey = config?.has_api_key ?? false;
  const providerHintKey = `ai.getKeyHint${provider.charAt(0).toUpperCase() + provider.slice(1)}`;

  return (
    <div className="rounded-2xl glass p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary/70" />
        <h2 className="text-sm font-semibold">{t("ai.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("ai.description")}</p>

      {/* Storage migration notice — visible iff the user has no API key
          configured under the new encrypted-file storage. Shown to:
          (a) new users (harmless, mentions "no popups" as a perk)
          (b) returning users whose old keyring-backed key is now stale.
          We deliberately don't try to silently migrate from the keyring —
          touching it would trigger the very popup we're trying to avoid. */}
      {!hasApiKey && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-50/40 dark:bg-amber-500/8 p-3 space-y-1">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {t("ai.storageMigratedTitle")}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("ai.storageMigratedDesc")}
          </p>
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          className="size-4 rounded border-border accent-primary"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="text-sm">{t("ai.enable")}</span>
      </label>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("ai.provider")}
        </label>
        <select
          className={cn(nativeSelectClass, "w-full")}
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {PROVIDER_ORDER.map((key) => {
            const labelKey = `ai.provider${key.charAt(0).toUpperCase() + key.slice(1)}`;
            return (
              <option key={key} value={key}>
                {t(labelKey)}
              </option>
            );
          })}
        </select>
      </div>

      {presetSignupUrl && (
        <div className="rounded-xl border border-dashed border-primary/30 bg-primary/4 p-3 space-y-1.5">
          <p className="text-xs font-medium text-foreground">{t("ai.getKeyTitle")}</p>
          <p className="text-xs text-muted-foreground">{t(providerHintKey)}</p>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => openUrl(presetSignupUrl)}
          >
            <ExternalLink className="size-3" />
            {provider === "ollama" ? t("ai.getOllamaButton") : t("ai.getKeyButton")}
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            {t("ai.apiKey")}
          </label>
          <span
            className={cn(
              "text-[10px] font-medium tabular-nums",
              hasApiKey ? "text-emerald-500" : "text-muted-foreground/60",
            )}
          >
            {hasApiKey ? `● ${t("ai.apiKeyConfigured")}` : `○ ${t("ai.apiKeyEmpty")}`}
          </span>
        </div>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              className="w-full rounded-xl border border-border bg-background/60 px-3 py-1.5 pr-9 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              placeholder={t("ai.apiKeyPlaceholder")}
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "hide" : "show"}
            >
              {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <Button
            variant="default"
            size="sm"
            disabled={!apiKeyDraft.trim() || setApiKey.isPending}
            onClick={handleSaveKey}
          >
            {keySaved ? <Check className="size-3" /> : t("ai.save")}
          </Button>
          {hasApiKey && (
            <Button
              variant="outline"
              size="sm"
              disabled={clearApiKey.isPending}
              onClick={handleClearKey}
            >
              {keyCleared ? t("ai.apiKeyCleared") : t("ai.apiKeyClear")}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/70">{t("ai.apiKeyHint")}</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("ai.model")}
        </label>
        <input
          type="text"
          className="w-full rounded-xl border border-border bg-background/60 px-3 py-1.5 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={PROVIDER_PRESETS[provider]?.defaultModel ?? ""}
        />
        <p className="text-[11px] text-muted-foreground/70">{t("ai.modelHint")}</p>
      </div>

      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground select-none"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {t("ai.advanced")}
      </button>

      {showAdvanced && (
        <div className="space-y-1.5 pl-4 border-l border-border/50">
          <label className="text-xs font-medium text-muted-foreground">
            {t("ai.baseUrl")}
          </label>
          <input
            type="text"
            className="w-full rounded-xl border border-border bg-background/60 px-3 py-1.5 text-xs font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={PROVIDER_PRESETS[provider]?.baseUrl ?? ""}
          />
          <p className="text-[11px] text-muted-foreground/70">{t("ai.baseUrlHint")}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button
          variant="default"
          size="sm"
          disabled={saveConfig.isPending}
          onClick={handleSave}
        >
          {savedRecently ? <Check className="size-3" /> : t("ai.save")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={testing || !hasApiKey}
          onClick={handleTest}
          className="gap-1.5"
        >
          {testing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {testing ? t("ai.testing") : t("ai.test")}
        </Button>
        {testResult && (
          <span
            className={cn(
              "text-xs font-medium",
              testResult.ok ? "text-emerald-500" : "text-destructive",
            )}
          >
            {testResult.ok
              ? t("ai.testSuccess", { ms: testResult.latency_ms ?? "?" })
              : t("ai.testFailed", { message: testResult.message })}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-border/40 bg-muted/6 p-3">
        <p className="text-[11px] font-medium text-foreground mb-1">🔒 {t("ai.privacyTitle")}</p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{t("ai.privacyDesc")}</p>
      </div>
    </div>
  );
}
