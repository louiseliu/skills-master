use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::commands::settings::{read_settings, write_settings, AiConfig, AppSettings};

const DEFAULT_GLM_BASE: &str = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_GLM_MODEL: &str = "glm-4-flash";
const DEFAULT_OPENAI_BASE: &str = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL: &str = "gpt-4o-mini";
const DEFAULT_DEEPSEEK_BASE: &str = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL: &str = "deepseek-chat";
const DEFAULT_QWEN_BASE: &str = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_QWEN_MODEL: &str = "qwen-turbo";
const DEFAULT_OLLAMA_BASE: &str = "http://localhost:11434/v1";
const DEFAULT_OLLAMA_MODEL: &str = "llama3.2";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiConfigPublic {
    pub enabled: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub has_api_key: bool,
}

#[derive(Debug, Deserialize)]
pub struct AiConfigInput {
    pub enabled: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiTestResult {
    pub ok: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct AiSkillCandidate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AiRecommendation {
    pub skill_id: String,
    pub reason: String,
    pub score: f32,
}

#[derive(Debug, Serialize)]
pub struct AiSearchResponse {
    pub recommendations: Vec<AiRecommendation>,
    pub explanation: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct UnifiedRecommendation {
    pub skill_id: String,
    pub name: String,
    pub description: Option<String>,
    /// "local" | "marketplace"
    pub source_kind: String,
    /// 仅 marketplace 时存在：来源平台
    pub marketplace_source: Option<String>,
    /// 仅 marketplace 时存在：仓库地址（用于安装）
    pub repository: Option<String>,
    pub reason: String,
    pub score: f32,
}

#[derive(Debug, Serialize)]
pub struct UnifiedSearchResponse {
    pub local: Vec<UnifiedRecommendation>,
    pub marketplace: Vec<UnifiedRecommendation>,
    pub explanation: String,
}

/// Encrypted-on-disk key the AI API token is stored under. Kept stable so
/// existing installs (post-migration) continue to find their token.
const SECRET_NAME_API_KEY: &str = "ai-api-key";

fn fill_defaults(mut cfg: AiConfig) -> AiConfig {
    let provider = cfg.provider.clone().unwrap_or_else(|| "glm".to_string());
    if cfg.base_url.as_deref().map(str::is_empty).unwrap_or(true) {
        cfg.base_url = Some(match provider.as_str() {
            "openai" => DEFAULT_OPENAI_BASE.to_string(),
            "deepseek" => DEFAULT_DEEPSEEK_BASE.to_string(),
            "qwen" => DEFAULT_QWEN_BASE.to_string(),
            "ollama" => DEFAULT_OLLAMA_BASE.to_string(),
            _ => DEFAULT_GLM_BASE.to_string(),
        });
    }
    if cfg.model.as_deref().map(str::is_empty).unwrap_or(true) {
        cfg.model = Some(match provider.as_str() {
            "openai" => DEFAULT_OPENAI_MODEL.to_string(),
            "deepseek" => DEFAULT_DEEPSEEK_MODEL.to_string(),
            "qwen" => DEFAULT_QWEN_MODEL.to_string(),
            "ollama" => DEFAULT_OLLAMA_MODEL.to_string(),
            _ => DEFAULT_GLM_MODEL.to_string(),
        });
    }
    cfg.provider = Some(provider);
    cfg
}

fn read_api_key() -> Option<String> {
    // No keyring fallback any more — the encrypted store is the source of
    // truth. Users coming from the keyring era are guided to re-enter their
    // key (one-time) via the Settings page; doing so silently was unsafe.
    match crate::security::get_secret(SECRET_NAME_API_KEY) {
        Ok(Some(s)) if !s.trim().is_empty() => Some(s),
        _ => None,
    }
}

#[tauri::command]
pub fn ai_get_config() -> Result<AiConfigPublic, String> {
    let settings = read_settings()?;
    let cfg = settings.ai.unwrap_or_default();
    let cfg = fill_defaults(cfg);
    Ok(AiConfigPublic {
        enabled: cfg.enabled,
        provider: cfg.provider,
        model: cfg.model,
        base_url: cfg.base_url,
        has_api_key: read_api_key().is_some(),
    })
}

#[tauri::command]
pub fn ai_save_config(config: AiConfigInput) -> Result<(), String> {
    let mut settings = read_settings().unwrap_or_default();
    settings.ai = Some(AiConfig {
        enabled: config.enabled,
        provider: config.provider,
        model: config.model,
        base_url: config.base_url,
    });
    write_settings(settings)
}

#[tauri::command]
pub fn ai_set_api_key(api_key: String) -> Result<(), String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("API key is empty".into());
    }
    crate::security::set_secret(SECRET_NAME_API_KEY, trimmed)
}

#[tauri::command]
pub fn ai_clear_api_key() -> Result<(), String> {
    crate::security::delete_secret(SECRET_NAME_API_KEY)
}

fn build_chat_request(
    base_url: &str,
    model: &str,
    api_key: &str,
    system: &str,
    user: &str,
    json_object: bool,
) -> Result<serde_json::Value, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
        "temperature": 0.2,
    });
    if json_object {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }

    let client = crate::network::build_blocking_client("SkillsMaster-AI/1.0")
        .map_err(|e| format!("client build failed: {e}"))?;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("HTTP {status}: {snippet}"));
    }
    resp.json::<serde_json::Value>()
        .map_err(|e| format!("decode failed: {e}"))
}

fn extract_message_content(resp: &serde_json::Value) -> Option<String> {
    resp.get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()
        .map(str::to_string)
}

#[tauri::command]
pub async fn ai_test_connection() -> Result<AiTestResult, String> {
    let cfg = ai_get_config()?;
    if !cfg.has_api_key {
        return Ok(AiTestResult {
            ok: false,
            message: "API Key 未配置".into(),
            latency_ms: None,
        });
    }
    let api_key = read_api_key().ok_or("无法读取 API Key")?;
    let base_url = cfg.base_url.unwrap_or_else(|| DEFAULT_GLM_BASE.to_string());
    let model = cfg.model.unwrap_or_else(|| DEFAULT_GLM_MODEL.to_string());

    let start = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        build_chat_request(
            &base_url,
            &model,
            &api_key,
            "You are a connectivity test. Reply with the single word: pong.",
            "ping",
            false,
        )
    })
    .await
    .map_err(|e| format!("join error: {e}"))?;

    match result {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            let content = extract_message_content(&resp).unwrap_or_default();
            Ok(AiTestResult {
                ok: true,
                message: format!("连接成功，响应：{}", content.trim()),
                latency_ms: Some(latency),
            })
        }
        Err(e) => Ok(AiTestResult {
            ok: false,
            message: format!("连接失败：{e}"),
            latency_ms: None,
        }),
    }
}

const SEARCH_SYSTEM_PROMPT: &str = "你是一个 AI 技能（SKILL）推荐助手。\n\
用户会给出他的需求，以及一份候选技能列表（id / name / description）。\n\
请从列表中推荐最相关的最多 5 个技能，必须只从列表中选择，不要编造任何不存在的 id。\n\
返回严格的 JSON 对象，结构：\n\
{\n  \"recommendations\": [\n    {\"skill_id\": string, \"reason\": string, \"score\": number 0-1}\n  ],\n  \"explanation\": string  // 一句中文解读，向用户说明你的整体匹配思路\n}\n\
只输出 JSON，不要任何额外文本。score 越高表示越相关。";

#[tauri::command]
pub async fn ai_search_skills(
    query: String,
    candidates: Vec<AiSkillCandidate>,
) -> Result<AiSearchResponse, String> {
    let cfg = ai_get_config()?;
    if !cfg.enabled {
        return Err("AI 功能未启用，请前往设置开启".into());
    }
    if !cfg.has_api_key {
        return Err("API Key 未配置，请前往设置".into());
    }
    if query.trim().is_empty() {
        return Err("查询不能为空".into());
    }
    if candidates.is_empty() {
        return Err("候选技能列表为空".into());
    }

    let api_key = read_api_key().ok_or("无法读取 API Key")?;
    let base_url = cfg.base_url.unwrap_or_else(|| DEFAULT_GLM_BASE.to_string());
    let model = cfg.model.unwrap_or_else(|| DEFAULT_GLM_MODEL.to_string());

    let mut user_prompt = format!("用户需求：{}\n\n候选技能列表：\n", query.trim());
    for c in &candidates {
        let desc = c.description.as_deref().unwrap_or("(无描述)");
        user_prompt.push_str(&format!("- id={} | name={} | description={}\n", c.id, c.name, desc));
    }

    let resp = tokio::task::spawn_blocking(move || {
        build_chat_request(
            &base_url,
            &model,
            &api_key,
            SEARCH_SYSTEM_PROMPT,
            &user_prompt,
            true,
        )
    })
    .await
    .map_err(|e| format!("join error: {e}"))??;

    let content = extract_message_content(&resp).ok_or("AI 未返回内容")?;
    let parsed: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("AI 输出非法 JSON：{e}\n原文：{content}"))?;

    let valid_ids: std::collections::HashSet<&str> =
        candidates.iter().map(|c| c.id.as_str()).collect();

    let mut recommendations = Vec::new();
    if let Some(arr) = parsed.get("recommendations").and_then(|v| v.as_array()) {
        for item in arr {
            let skill_id = match item.get("skill_id").and_then(|v| v.as_str()) {
                Some(s) => s,
                None => continue,
            };
            if !valid_ids.contains(skill_id) {
                continue;
            }
            let reason = item
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let score = item
                .get("score")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0) as f32;
            recommendations.push(AiRecommendation {
                skill_id: skill_id.to_string(),
                reason,
                score: score.clamp(0.0, 1.0),
            });
        }
    }

    let explanation = parsed
        .get("explanation")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(AiSearchResponse {
        recommendations,
        explanation,
    })
}

const UNIFIED_SYSTEM_PROMPT: &str = "你是一个 AI 技能（SKILL）推荐助手，帮用户从两类候选中选最相关的技能：\n\
1) LOCAL：用户已经安装在本地的技能。\n\
2) MARKETPLACE：用户尚未安装、来自市场的技能。\n\
\n\
输入会标注每条候选的 source_kind（local 或 marketplace）。请只从给定列表中选择，不要编造任何不存在的 id。\n\
返回严格的 JSON 对象：\n\
{\n  \"recommendations\": [\n    {\"skill_id\": string, \"source_kind\": \"local\" | \"marketplace\", \"reason\": string, \"score\": number 0-1}\n  ],\n  \"explanation\": string\n}\n\
最多 8 条，按 score 降序。如本地技能能满足需求，请优先推荐本地（让用户先用上手头的）。只输出 JSON，不要任何额外文本。";

#[derive(Debug, Deserialize)]
pub struct UnifiedLocalCandidate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

/// 双源 AI 搜索：本地已安装 + 市场未安装，AI 统一排序后返回分组结果。
///
/// scope 取值：
/// - "all"：本地 + 市场
/// - "local"：仅本地
/// - "marketplace"：仅市场
#[tauri::command]
pub async fn ai_search_unified(
    query: String,
    scope: String,
    local_candidates: Vec<UnifiedLocalCandidate>,
) -> Result<UnifiedSearchResponse, String> {
    let cfg = ai_get_config()?;
    if !cfg.enabled {
        return Err("AI 功能未启用，请前往设置开启".into());
    }
    if !cfg.has_api_key {
        return Err("API Key 未配置，请前往设置".into());
    }
    if query.trim().is_empty() {
        return Err("查询不能为空".into());
    }

    let scope = scope.as_str();
    let want_local = scope == "all" || scope == "local";
    let want_market = scope == "all" || scope == "marketplace";

    // 1) 拉取市场候选（如果需要）
    let q = query.trim().to_string();
    let market_items = if want_market {
        let q_clone = q.clone();
        tokio::task::spawn_blocking(move || crate::marketplace::search_combined(&q_clone))
            .await
            .map_err(|e| format!("market join error: {e}"))?
    } else {
        Vec::new()
    };

    // 2) 收集本地候选
    let local_items: Vec<UnifiedLocalCandidate> = if want_local { local_candidates } else { Vec::new() };

    if local_items.is_empty() && market_items.is_empty() {
        return Ok(UnifiedSearchResponse {
            local: Vec::new(),
            marketplace: Vec::new(),
            explanation: "没有可供推荐的候选".into(),
        });
    }

    // 3) 构造 prompt
    let mut user_prompt = format!("用户需求：{}\n\n候选列表：\n", q);
    for c in &local_items {
        let desc = c.description.as_deref().unwrap_or("(无描述)");
        user_prompt.push_str(&format!(
            "- source_kind=local | id={} | name={} | description={}\n",
            c.id, c.name, desc,
        ));
    }
    // 市场候选用 name 作为 id（marketplace skills 没有稳定的 id，统一以 name 为 key，
    //   并保留 repository 用于安装。后端再根据 name 找回 repository）
    let market_capped = market_items.iter().take(80).collect::<Vec<_>>();
    for s in &market_capped {
        let desc = s.description.as_deref().unwrap_or("(无描述)");
        user_prompt.push_str(&format!(
            "- source_kind=marketplace | id={} | name={} | description={}\n",
            s.name, s.name, desc,
        ));
    }

    // 4) 调 AI
    let api_key = read_api_key().ok_or("无法读取 API Key")?;
    let base_url = cfg.base_url.unwrap_or_else(|| DEFAULT_GLM_BASE.to_string());
    let model = cfg.model.unwrap_or_else(|| DEFAULT_GLM_MODEL.to_string());

    let resp = tokio::task::spawn_blocking(move || {
        build_chat_request(
            &base_url,
            &model,
            &api_key,
            UNIFIED_SYSTEM_PROMPT,
            &user_prompt,
            true,
        )
    })
    .await
    .map_err(|e| format!("ai join error: {e}"))??;

    let content = extract_message_content(&resp).ok_or("AI 未返回内容")?;
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("AI 输出非法 JSON：{e}\n原文：{content}"))?;

    let local_id_set: std::collections::HashSet<&str> =
        local_items.iter().map(|c| c.id.as_str()).collect();
    let market_by_name: std::collections::HashMap<String, &crate::marketplace::MarketplaceSkill> =
        market_capped
            .iter()
            .map(|s| (s.name.to_lowercase(), *s))
            .collect();

    let mut local_out: Vec<UnifiedRecommendation> = Vec::new();
    let mut market_out: Vec<UnifiedRecommendation> = Vec::new();

    if let Some(arr) = parsed.get("recommendations").and_then(|v| v.as_array()) {
        for item in arr {
            let skill_id = match item.get("skill_id").and_then(|v| v.as_str()) {
                Some(s) => s,
                None => continue,
            };
            let kind = item
                .get("source_kind")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let reason = item
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let score = item
                .get("score")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0) as f32;

            if kind == "local" {
                if !local_id_set.contains(skill_id) {
                    continue;
                }
                let local = local_items.iter().find(|c| c.id == skill_id);
                let (name, description) = match local {
                    Some(c) => (c.name.clone(), c.description.clone()),
                    None => continue,
                };
                local_out.push(UnifiedRecommendation {
                    skill_id: skill_id.to_string(),
                    name,
                    description,
                    source_kind: "local".into(),
                    marketplace_source: None,
                    repository: None,
                    reason,
                    score: score.clamp(0.0, 1.0),
                });
            } else if kind == "marketplace" {
                let key = skill_id.to_lowercase();
                let mk = match market_by_name.get(&key) {
                    Some(m) => *m,
                    None => continue,
                };
                market_out.push(UnifiedRecommendation {
                    skill_id: mk.name.clone(),
                    name: mk.name.clone(),
                    description: mk.description.clone(),
                    source_kind: "marketplace".into(),
                    marketplace_source: Some(mk.source.clone()),
                    repository: mk.repository.clone(),
                    reason,
                    score: score.clamp(0.0, 1.0),
                });
            }
        }
    }

    let explanation = parsed
        .get("explanation")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(UnifiedSearchResponse {
        local: local_out,
        marketplace: market_out,
        explanation,
    })
}

// ============================================================
//  AI Skill Explain  ——  given SKILL.md content, generate
//  a concise plain-Chinese explanation tailored for end users.
// ============================================================

const EXPLAIN_SYSTEM_PROMPT: &str = "你是一个 AI 技能文档解读助手。\n\
用户会提供一份 SKILL.md（技能说明文档）的内容，可能比较长且专业。\n\
请生成简明、亲切、结构化的中文解读，帮助普通用户**3 秒内**判断这个技能能做什么、何时用、值不值得安装。\n\n\
返回严格的 JSON 对象，结构：\n\
{\n  \"summary\": string,         // 1 句话总结，30 字内\n  \"purpose\": string,         // 这个技能的用途，1-2 句\n  \"when_to_use\": [string],    // 3-5 个适用场景关键词或短句\n  \"key_capabilities\": [string], // 3-5 个核心能力，短句\n  \"good_for\": string,         // 适合什么样的用户/工作流，1 句\n  \"caveats\": string | null    // 可选：使用注意事项或限制；没有时返回 null\n}\n\
\n\
要求：\n\
- 输出中文，语气友好、专业但不啰嗦。\n\
- 不要照抄文档原文，要重新组织语言提炼要点。\n\
- 只输出 JSON，不要任何额外解释或 markdown 代码块。";

#[derive(Debug, Serialize, Default)]
pub struct AiExplainResponse {
    pub summary: String,
    pub purpose: String,
    pub when_to_use: Vec<String>,
    pub key_capabilities: Vec<String>,
    pub good_for: String,
    pub caveats: Option<String>,
}

/// AI 解读技能：根据 SKILL.md 内容生成易于理解的中文摘要
#[tauri::command]
pub async fn ai_explain_skill(
    skill_name: String,
    content: String,
) -> Result<AiExplainResponse, String> {
    let cfg = ai_get_config()?;
    if !cfg.enabled {
        return Err("AI 功能未启用，请前往设置开启".into());
    }
    if !cfg.has_api_key {
        return Err("API Key 未配置，请前往设置".into());
    }

    let body = content.trim();
    if body.is_empty() {
        return Err("技能内容为空，无法解读".into());
    }

    // Truncate very long documents to keep cost / latency reasonable
    let truncated: String = if body.chars().count() > 6000 {
        body.chars().take(6000).collect::<String>() + "\n\n...[文档已截断]"
    } else {
        body.to_string()
    };

    let api_key = read_api_key().ok_or("无法读取 API Key")?;
    let base_url = cfg.base_url.unwrap_or_else(|| DEFAULT_GLM_BASE.to_string());
    let model = cfg.model.unwrap_or_else(|| DEFAULT_GLM_MODEL.to_string());

    let user_prompt = format!(
        "技能名称：{}\n\nSKILL.md 内容如下：\n\n{}",
        skill_name.trim(),
        truncated
    );

    let resp = tokio::task::spawn_blocking(move || {
        build_chat_request(
            &base_url,
            &model,
            &api_key,
            EXPLAIN_SYSTEM_PROMPT,
            &user_prompt,
            true,
        )
    })
    .await
    .map_err(|e| format!("join error: {e}"))??;

    let raw = extract_message_content(&resp).ok_or("AI 未返回内容")?;
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("AI 输出非法 JSON：{e}\n原文：{raw}"))?;

    let as_str = |v: &serde_json::Value| v.as_str().unwrap_or("").to_string();
    let as_str_list = |v: &serde_json::Value| -> Vec<String> {
        v.as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .filter(|s| !s.trim().is_empty())
                    .collect()
            })
            .unwrap_or_default()
    };

    let summary = parsed.get("summary").map(as_str).unwrap_or_default();
    let purpose = parsed.get("purpose").map(as_str).unwrap_or_default();
    let when_to_use = parsed
        .get("when_to_use")
        .map(as_str_list)
        .unwrap_or_default();
    let key_capabilities = parsed
        .get("key_capabilities")
        .map(as_str_list)
        .unwrap_or_default();
    let good_for = parsed.get("good_for").map(as_str).unwrap_or_default();
    let caveats = parsed
        .get("caveats")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty());

    Ok(AiExplainResponse {
        summary,
        purpose,
        when_to_use,
        key_capabilities,
        good_for,
        caveats,
    })
}

// ============================================================
//  AI tag suggestion  ——  asks the model to propose 3-5 short tags
//  for a skill based on its name / description / first KB of body.
//
//  Why this lives in `ai.rs` rather than `tags.rs`:
//   - Reuses the same auth, config, retry, and base_url plumbing.
//   - Returns a flat list of normalized strings; storage decisions
//     stay in `tags.rs` (the frontend asks the user to accept/edit
//     before persisting). Keeps suggestion and persistence decoupled.
// ============================================================

const TAG_SUGGEST_SYSTEM_PROMPT: &str = "你是 AI 技能（SKILL）标签建议器。\n\
仅根据「技能名称 + 描述 + 已有标签」推断 3-5 个简短中文标签,用于桌面应用聚类/筛选。\n\n\
规则:\n\
- 每个标签 2-6 个汉字（或同等长度英文短语）。\n\
- 无标点/无 #/无序号。\n\
- 反映「领域/工具/场景」,避免过于宽泛（如「AI」「工具」）。\n\
- 已有标签可作为风格参照,但不要重复输出已有标签。\n\
- 严格 JSON 直接输出,无 markdown,无解释:{\"tags\":[\"...\",\"...\"]}";

#[derive(Debug, Serialize, Clone)]
pub struct AiSuggestTagsResponse {
    pub tags: Vec<String>,
}

/// AI tag suggestion — frontmatter-only.
///
/// Inputs:
///   - `skill_name` / `description`: from SKILL.md frontmatter
///   - `existing_tags`: current tags on the skill. Passed to the model as
///     both STYLE EXAMPLES (match existing taxonomy) and a NEGATIVE LIST
///     (don't propose duplicates). Empty/missing is fine for fresh skills.
///
/// We deliberately do NOT accept SKILL.md body — frontmatter alone is
/// dense, curated metadata and skipping the body is ~10x faster.
#[tauri::command]
pub async fn ai_suggest_skill_tags(
    skill_name: String,
    description: Option<String>,
    existing_tags: Option<Vec<String>>,
) -> Result<AiSuggestTagsResponse, String> {
    let cfg = ai_get_config()?;
    if !cfg.enabled {
        return Err("AI 功能未启用，请前往设置开启".into());
    }
    if !cfg.has_api_key {
        return Err("API Key 未配置，请前往设置".into());
    }

    // === Minimal prompt — frontmatter-only ===
    // We deliberately do NOT send SKILL.md body. The frontmatter (name +
    // description + existing keywords) is dense, curated metadata; the body
    // is verbose docs/examples that bloat token count without improving
    // tag quality. Skipping body shrinks input from ~2500 chars to <300,
    // ~10x faster end-to-end for the suggestion call.
    let desc = description.unwrap_or_default();
    let existing = existing_tags
        .unwrap_or_default()
        .into_iter()
        .filter(|t| !t.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ");

    let existing_line = if existing.is_empty() {
        String::new()
    } else {
        format!("\n已有标签:{existing}")
    };

    let user_prompt = format!(
        "技能名称:{}\n描述:{}{}",
        skill_name.trim(),
        desc.trim(),
        existing_line
    );

    let api_key = read_api_key().ok_or("无法读取 API Key")?;
    let base_url = cfg.base_url.unwrap_or_else(|| DEFAULT_GLM_BASE.to_string());
    let model = cfg.model.unwrap_or_else(|| DEFAULT_GLM_MODEL.to_string());

    // Inline request builder (not build_chat_request) so we can set
    // max_tokens — the generic helper doesn't expose that knob and 3-5
    // short tags should never need more than ~80 output tokens. Capping
    // prevents the model from drifting into a long explanation before the
    // JSON, which is the #1 cause of "AI tag is slow" complaints.
    let started = std::time::Instant::now();
    let dbg_name = skill_name.clone();
    let dbg_model = model.clone();
    eprintln!(
        "[ai-tags] start name={} model={} prompt_chars={}",
        dbg_name,
        dbg_model,
        user_prompt.chars().count()
    );
    let resp = tokio::task::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let body_json = serde_json::json!({
            "model": model,
            "messages": [
                { "role": "system", "content": TAG_SUGGEST_SYSTEM_PROMPT },
                { "role": "user", "content": user_prompt },
            ],
            "temperature": 0.2,
            // Hard cap — 5 tags × 6 chars × 1.5 token/char ≈ 45 output.
            // 96 leaves room for JSON braces while still aborting any
            // "let me think out loud first" drift. Lower than 128 since
            // we no longer need to absorb body-derived chatter.
            "max_tokens": 96,
            "response_format": { "type": "json_object" },
        });

        // Short, per-request timeout — tag suggestion that takes more than
        // 15s is almost certainly going to fail anyway; fail fast and let
        // the user retry instead of staring at a frozen spinner.
        let client = crate::network::build_blocking_client_with_timeout(
            "SkillsMaster-AI-Tags/1.0",
            std::time::Duration::from_secs(15),
        )
        .map_err(|e| format!("client build failed: {e}"))?;

        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body_json)
            .send()
            .map_err(|e| format!("request failed: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().unwrap_or_default();
            let snippet: String = text.chars().take(300).collect();
            return Err(format!("HTTP {status}: {snippet}"));
        }
        resp.json::<serde_json::Value>()
            .map_err(|e| format!("decode failed: {e}"))
    })
    .await
    .map_err(|e| format!("join error: {e}"))??;

    let raw = extract_message_content(&resp).ok_or("AI 未返回内容")?;
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("AI 输出非法 JSON：{e}\n原文：{raw}"))?;

    let tags: Vec<String> = parsed
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .filter_map(|s| crate::parser::skillmd::normalize_tag(&s))
                .collect()
        })
        .unwrap_or_default();

    let tags = crate::parser::skillmd::dedup_tags(tags);
    // Defensive caps: never overwhelm the UI even if the model goes wild.
    let tags: Vec<String> = tags.into_iter().take(8).collect();

    eprintln!(
        "[ai-tags] done name={} elapsed_ms={} tags={:?}",
        dbg_name,
        started.elapsed().as_millis(),
        tags
    );
    Ok(AiSuggestTagsResponse { tags })
}

// ============================================================
//  Streaming explanation  ——  short, AI-generated reasoning text
//  emitted incrementally via Tauri Channel for a typewriter UX.
//
//  Used in parallel with `ai_search_unified` so the user sees the
//  model "thinking out loud" while structured recommendations are
//  computed. We never stream the recommendation JSON itself (LLMs
//  + json_object mode + streaming are unstable across providers,
//  and raw JSON typewriter is ugly).
// ============================================================

/// Stream events emitted by `ai_stream_search_explanation` / `ai_stream_explain_summary`.
///
/// Variant `kind` is serialized as lowercase to keep TS client code tiny.
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiStreamEvent {
    /// User-visible progress milestone (e.g. "scanning marketplace").
    /// Frontend translates `code` via i18n to keep the binary lean.
    Step { code: String },
    /// Incremental text delta from the LLM.
    Delta { text: String },
    /// Stream finished successfully. `full_text` lets the frontend reconcile
    /// any missed deltas (defensive — usually equals concatenated deltas).
    Done {
        full_text: String,
        latency_ms: u64,
    },
    /// Stream aborted with an error.
    Error { message: String },
}

/// Best-effort SSE line parser.
///
/// OpenAI-compatible servers emit `data: {...}\n\n` framing. Some providers
/// (e.g. Ollama) just stream NDJSON. We accept both: any JSON object after
/// stripping an optional `data: ` prefix, ignoring `[DONE]` markers.
fn extract_delta_text(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let payload = trimmed.strip_prefix("data:").map(str::trim).unwrap_or(trimmed);
    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }
    let json: serde_json::Value = serde_json::from_str(payload).ok()?;
    json.get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Stream chat completions from an OpenAI-compatible endpoint, pushing each
/// content delta into `channel`. Returns the concatenated full text.
async fn stream_chat_completion(
    base_url: &str,
    model: &str,
    api_key: &str,
    system: &str,
    user: &str,
    channel: &Channel<AiStreamEvent>,
) -> Result<(String, u64), String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
        "temperature": 0.4,
        "stream": true,
    });

    let client = crate::network::build_async_client("SkillsMaster-AI-Stream/1.0")
        .map_err(|e| format!("client build failed: {e}"))?;

    let started = std::time::Instant::now();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let snippet: String = text.chars().take(300).collect();
        return Err(format!("HTTP {status}: {snippet}"));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("stream error: {e}"))?;
        // SSE / NDJSON framing: append to a rolling buffer, split on `\n`.
        // We carry the trailing partial line over to the next chunk.
        buf.push_str(&String::from_utf8_lossy(&chunk));
        loop {
            let Some(nl) = buf.find('\n') else { break };
            let line: String = buf.drain(..=nl).collect();
            if let Some(delta) = extract_delta_text(&line) {
                full.push_str(&delta);
                let _ = channel.send(AiStreamEvent::Delta { text: delta });
            }
        }
    }
    // Flush any trailing partial line (e.g. provider didn't terminate with \n).
    if !buf.trim().is_empty() {
        if let Some(delta) = extract_delta_text(&buf) {
            full.push_str(&delta);
            let _ = channel.send(AiStreamEvent::Delta { text: delta });
        }
    }

    Ok((full, started.elapsed().as_millis() as u64))
}

const STREAM_EXPLANATION_PROMPT: &str = "你是一个 AI 技能推荐助手。\n\
用户会给你他的需求 + 候选技能规模信息。\n\
请用 1-2 句简短的中文，自然亲切地告诉用户：你将从哪些方向去匹配这个需求、\n\
重点会看候选的什么特征。**不要列举具体技能 id 或 name**，不要输出 JSON。\n\
**控制在 60 个汉字以内**，避免啰嗦。直接开始说，不要任何前缀。";

/// Streams a short, natural-language explanation of how the AI is reasoning
/// about the user's request, in parallel with the structured search call.
///
/// Lightweight (~50 tokens of output) so cost impact is negligible. UI
/// renders the deltas with a typewriter effect to mask perceived latency
/// of the heavier `ai_search_unified` call.
#[tauri::command]
pub async fn ai_stream_search_explanation(
    query: String,
    scope: String,
    local_count: usize,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), String> {
    let cfg = ai_get_config()?;
    if !cfg.enabled {
        let _ = on_event.send(AiStreamEvent::Error {
            message: "AI 功能未启用".into(),
        });
        return Err("AI 功能未启用".into());
    }
    if !cfg.has_api_key {
        let _ = on_event.send(AiStreamEvent::Error {
            message: "API Key 未配置".into(),
        });
        return Err("API Key 未配置".into());
    }
    let q = query.trim().to_string();
    if q.is_empty() {
        let _ = on_event.send(AiStreamEvent::Error {
            message: "查询为空".into(),
        });
        return Err("查询为空".into());
    }

    let api_key = read_api_key().ok_or_else(|| "无法读取 API Key".to_string())?;
    let base_url = cfg.base_url.unwrap_or_else(|| DEFAULT_GLM_BASE.to_string());
    let model = cfg.model.unwrap_or_else(|| DEFAULT_GLM_MODEL.to_string());

    let _ = on_event.send(AiStreamEvent::Step {
        code: "thinking".into(),
    });

    let user_prompt = format!(
        "用户需求：{}\n候选范围：scope={}，本地已安装 {} 个技能。\n请给出你的匹配思路。",
        q, scope, local_count
    );

    match stream_chat_completion(
        &base_url,
        &model,
        &api_key,
        STREAM_EXPLANATION_PROMPT,
        &user_prompt,
        &on_event,
    )
    .await
    {
        Ok((full, latency_ms)) => {
            let _ = on_event.send(AiStreamEvent::Done {
                full_text: full,
                latency_ms,
            });
            Ok(())
        }
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error { message: e.clone() });
            Err(e)
        }
    }
}

const STREAM_EXPLAIN_SUMMARY_PROMPT: &str = "你是一个技能文档解读助手。\n\
用户会给你一份 SKILL.md 节选。\n\
请用 1-2 句简短中文，自然亲切地告诉用户：这个技能大概是干嘛的、最值得关注的特点是什么。\n\
**不要列要点、不要用 markdown 列表**，直接说一段顺滑的话。**控制在 80 个汉字以内**。\n\
不要前缀，直接开始。";

/// Streams a short prose summary of a skill, while the heavier
/// `ai_explain_skill` (structured JSON) call runs in parallel on the frontend.
#[tauri::command]
pub async fn ai_stream_explain_summary(
    skill_name: String,
    content: String,
    on_event: Channel<AiStreamEvent>,
) -> Result<(), String> {
    let cfg = ai_get_config()?;
    if !cfg.enabled {
        let _ = on_event.send(AiStreamEvent::Error {
            message: "AI 功能未启用".into(),
        });
        return Err("AI 功能未启用".into());
    }
    if !cfg.has_api_key {
        let _ = on_event.send(AiStreamEvent::Error {
            message: "API Key 未配置".into(),
        });
        return Err("API Key 未配置".into());
    }
    let body = content.trim();
    if body.is_empty() {
        let _ = on_event.send(AiStreamEvent::Error {
            message: "内容为空".into(),
        });
        return Err("内容为空".into());
    }

    let truncated: String = if body.chars().count() > 4000 {
        body.chars().take(4000).collect::<String>() + "\n\n...[文档已截断]"
    } else {
        body.to_string()
    };

    let api_key = read_api_key().ok_or_else(|| "无法读取 API Key".to_string())?;
    let base_url = cfg.base_url.unwrap_or_else(|| DEFAULT_GLM_BASE.to_string());
    let model = cfg.model.unwrap_or_else(|| DEFAULT_GLM_MODEL.to_string());

    let _ = on_event.send(AiStreamEvent::Step {
        code: "thinking".into(),
    });

    let user_prompt = format!(
        "技能名称：{}\n\nSKILL.md 节选：\n{}",
        skill_name.trim(),
        truncated
    );

    match stream_chat_completion(
        &base_url,
        &model,
        &api_key,
        STREAM_EXPLAIN_SUMMARY_PROMPT,
        &user_prompt,
        &on_event,
    )
    .await
    {
        Ok((full, latency_ms)) => {
            let _ = on_event.send(AiStreamEvent::Done {
                full_text: full,
                latency_ms,
            });
            Ok(())
        }
        Err(e) => {
            let _ = on_event.send(AiStreamEvent::Error { message: e.clone() });
            Err(e)
        }
    }
}

#[allow(dead_code)]
fn _unused_app_settings_check(_s: AppSettings) {}
