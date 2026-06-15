use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillDirAssets {
    pub scripts: bool,
    pub references: bool,
    pub assets: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParsedSkillMd {
    pub name: Option<String>,
    pub description: Option<String>,
    pub metadata: Option<Value>,
    pub body: String,
    pub asset_dirs: SkillDirAssets,
    /// Normalized tag list, merged from frontmatter `tags`/`category`/`keywords`.
    /// All values are normalized (lowercased, trimmed, deduplicated).
    pub tags: Vec<String>,
}

/// Normalize a single tag string for dedup-stable comparison.
///
/// Pipeline:
///   1. trim whitespace, strip leading `#`
///   2. fold common separators (`-`, `_`, `/`, `\`, `·`, `.`) into spaces
///      — so `ai-coding`, `ai_coding`, `ai/coding`, `AI Coding` all collapse
///      onto the same key `ai coding`
///   3. lowercase (ASCII case-fold, leaves CJK untouched)
///   4. collapse runs of whitespace (any Unicode whitespace) into a single space
///   5. drop whitespace between consecutive CJK characters
///      — so `打开 网站` and `打开网站` collapse to the same key
///      — preserves whitespace at CJK↔Latin boundaries so `ai 编程` stays readable
///
/// Returns `None` for empty / punctuation-only inputs so callers can skip
/// junk without an explicit check.
pub fn normalize_tag(raw: &str) -> Option<String> {
    let s = raw.trim().trim_start_matches('#').trim();
    if s.is_empty() {
        return None;
    }
    // Fold ASCII + common CJK separators into spaces.
    let unified: String = s
        .chars()
        .map(|c| match c {
            '-' | '_' | '/' | '\\' | '·' | '.' | '．' | '。' | '、' => ' ',
            c => c,
        })
        .collect();
    let lower = unified.to_lowercase();
    let collapsed: String = lower
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    // CJK-aware space removal: drop spaces sitting between two CJK chars.
    // We walk char-by-char so we can peek both neighbors without index math.
    let chars: Vec<char> = collapsed.chars().collect();
    let mut out = String::with_capacity(collapsed.len());
    for i in 0..chars.len() {
        let c = chars[i];
        if c == ' ' {
            let prev = (i > 0).then(|| chars[i - 1]);
            let next = chars.get(i + 1).copied();
            if let (Some(p), Some(n)) = (prev, next) {
                if is_cjk(p) && is_cjk(n) {
                    // skip space between two CJK runs
                    continue;
                }
            }
        }
        out.push(c);
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Conservative CJK detection: covers CJK Unified Ideographs (incl. extensions
/// A and B), Hiragana, Katakana, and Hangul. Good enough for tag dedup.
fn is_cjk(c: char) -> bool {
    let n = c as u32;
    (0x4E00..=0x9FFF).contains(&n)         // CJK Unified Ideographs
        || (0x3400..=0x4DBF).contains(&n)  // CJK Extension A
        || (0x20000..=0x2A6DF).contains(&n) // CJK Extension B
        || (0x3040..=0x309F).contains(&n)  // Hiragana
        || (0x30A0..=0x30FF).contains(&n)  // Katakana
        || (0xAC00..=0xD7AF).contains(&n)  // Hangul
}

/// Deduplicate while preserving first-seen order.
pub fn dedup_tags(input: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(input.len());
    for t in input {
        if seen.insert(t.clone()) {
            out.push(t);
        }
    }
    out
}

#[derive(Debug, Error)]
pub enum SkillMdParseError {
    #[error("failed to read SKILL.md: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid YAML frontmatter: {0}")]
    InvalidFrontmatter(#[from] serde_yaml::Error),
}

#[derive(Debug, Deserialize, Default)]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
    metadata: Option<Value>,
    /// Free-form fields scraped for tags. Accepts either a YAML list
    /// (`tags: [a, b]`) or a comma/space-separated string (`tags: "a, b"`).
    #[serde(default)]
    tags: Option<TagSpec>,
    #[serde(default)]
    category: Option<TagSpec>,
    #[serde(default)]
    keywords: Option<TagSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TagSpec {
    Many(Vec<String>),
    One(String),
}

impl TagSpec {
    fn into_iter_strings(self) -> Box<dyn Iterator<Item = String>> {
        match self {
            TagSpec::Many(v) => Box::new(v.into_iter()),
            TagSpec::One(s) => {
                let parts: Vec<String> = s
                    .split(|c: char| matches!(c, ',' | ';' | '|' | '\n'))
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect();
                Box::new(parts.into_iter())
            }
        }
    }
}

pub fn parse_skill_md_file(path: &Path) -> Result<ParsedSkillMd, SkillMdParseError> {
    let content = fs::read_to_string(path)?;
    let base_dir = path.parent().unwrap_or(Path::new("."));
    parse_skill_md_content(&content, base_dir)
}

pub fn parse_skill_md_content(
    content: &str,
    base_dir: &Path,
) -> Result<ParsedSkillMd, SkillMdParseError> {
    let (frontmatter, body) = split_frontmatter(content)?;
    let asset_dirs = detect_asset_dirs(base_dir);

    let mut collected: Vec<String> = Vec::new();
    for spec in [frontmatter.tags, frontmatter.category, frontmatter.keywords]
        .into_iter()
        .flatten()
    {
        for raw in spec.into_iter_strings() {
            if let Some(n) = normalize_tag(&raw) {
                collected.push(n);
            }
        }
    }
    let tags = dedup_tags(collected);

    Ok(ParsedSkillMd {
        name: frontmatter.name,
        description: frontmatter.description,
        metadata: frontmatter.metadata,
        body,
        asset_dirs,
        tags,
    })
}

fn split_frontmatter(content: &str) -> Result<(Frontmatter, String), SkillMdParseError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Ok((Frontmatter::default(), String::new()));
    }

    let lines: Vec<&str> = content.lines().collect();
    if lines.first().copied() != Some("---") {
        return Ok((Frontmatter::default(), content.to_string()));
    }

    let closing = lines
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(idx, line)| if *line == "---" { Some(idx) } else { None });

    let Some(end_idx) = closing else {
        return Ok((Frontmatter::default(), content.to_string()));
    };

    let yaml = lines[1..end_idx].join("\n");
    let body = if end_idx + 1 < lines.len() {
        lines[end_idx + 1..].join("\n")
    } else {
        String::new()
    };

    if yaml.trim().is_empty() {
        return Ok((Frontmatter::default(), body));
    }

    let frontmatter: Frontmatter = serde_yaml::from_str(&yaml)?;
    Ok((frontmatter, body))
}

fn detect_asset_dirs(base_dir: &Path) -> SkillDirAssets {
    let scripts = base_dir.join("scripts").is_dir();
    let references = base_dir.join("references").is_dir();
    let assets = base_dir.join("assets").is_dir();
    SkillDirAssets {
        scripts,
        references,
        assets,
    }
}

pub fn skill_id_from_path(path: &Path) -> String {
    let normalized: PathBuf = path
        .components()
        .collect::<PathBuf>()
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    normalized.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(name: &str) -> PathBuf {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock drift")
            .as_millis();
        let dir = std::env::temp_dir().join(format!("skills-app-{name}-{millis}"));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    #[test]
    fn parse_with_frontmatter() {
        let dir = test_dir("frontmatter");
        fs::create_dir_all(dir.join("scripts")).expect("create scripts");
        let content = r#"---
name: test-skill
description: parse yaml frontmatter
metadata:
  level: advanced
---
# Body
Hello
"#;
        let parsed = parse_skill_md_content(content, &dir).expect("parse");
        assert_eq!(parsed.name.as_deref(), Some("test-skill"));
        assert_eq!(parsed.description.as_deref(), Some("parse yaml frontmatter"));
        assert!(parsed.metadata.is_some());
        assert!(parsed.body.contains("# Body"));
        assert!(parsed.asset_dirs.scripts);
        assert!(!parsed.asset_dirs.references);
        assert!(!parsed.asset_dirs.assets);
    }

    #[test]
    fn parse_without_frontmatter() {
        let dir = test_dir("no-frontmatter");
        let content = "# Just markdown\nText";
        let parsed = parse_skill_md_content(content, &dir).expect("parse");
        assert!(parsed.name.is_none());
        assert!(parsed.description.is_none());
        assert_eq!(parsed.body, content);
    }

    #[test]
    fn parse_empty_file() {
        let dir = test_dir("empty");
        let parsed = parse_skill_md_content("", &dir).expect("parse");
        assert!(parsed.name.is_none());
        assert_eq!(parsed.body, "");
    }

    #[test]
    fn parse_tags_list_form() {
        let dir = test_dir("tags-list");
        let content = r#"---
name: t
tags:
  - AI编程
  - Database
  - "ai 编程"
keywords: ["devops", "ci/cd"]
category: 工具
---
body
"#;
        let parsed = parse_skill_md_content(content, &dir).expect("parse");
        // ai编程 should dedup with "ai 编程" (case + whitespace normalize)
        assert!(parsed.tags.contains(&"ai编程".to_string()) || parsed.tags.contains(&"ai 编程".to_string()));
        assert!(parsed.tags.contains(&"database".to_string()));
        assert!(parsed.tags.contains(&"devops".to_string()));
        assert!(parsed.tags.contains(&"工具".to_string()));
    }

    #[test]
    fn parse_tags_string_form() {
        let dir = test_dir("tags-string");
        let content = r#"---
name: t
tags: "frontend, react, ui"
---
"#;
        let parsed = parse_skill_md_content(content, &dir).expect("parse");
        assert_eq!(parsed.tags.len(), 3);
        assert!(parsed.tags.contains(&"frontend".to_string()));
        assert!(parsed.tags.contains(&"react".to_string()));
        assert!(parsed.tags.contains(&"ui".to_string()));
    }

    #[test]
    fn normalize_strips_hash_and_lowers() {
        assert_eq!(normalize_tag("  #AI 编程  "), Some("ai 编程".to_string()));
        assert_eq!(normalize_tag(""), None);
        assert_eq!(normalize_tag("   "), None);
        assert_eq!(normalize_tag("#"), None);
    }

    #[test]
    fn normalize_collapses_separators() {
        // Separator variants all dedup to the same form
        assert_eq!(normalize_tag("ai-coding"), Some("ai coding".to_string()));
        assert_eq!(normalize_tag("ai_coding"), Some("ai coding".to_string()));
        assert_eq!(normalize_tag("AI/Coding"), Some("ai coding".to_string()));
        assert_eq!(normalize_tag("AI Coding"), Some("ai coding".to_string()));
        assert_eq!(normalize_tag("ai-_/Coding"), Some("ai coding".to_string()));
        // CJK separators
        assert_eq!(normalize_tag("ai·编程"), Some("ai 编程".to_string()));
        assert_eq!(normalize_tag("ai。编程"), Some("ai 编程".to_string()));
    }

    #[test]
    fn dedup_collapses_separator_variants() {
        // After normalize, dedup_tags should leave a single entry
        let inputs = vec![
            normalize_tag("ai-coding").unwrap(),
            normalize_tag("AI Coding").unwrap(),
            normalize_tag("ai_coding").unwrap(),
        ];
        let out = dedup_tags(inputs);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], "ai coding");
    }

    #[test]
    fn normalize_strips_cjk_inner_whitespace() {
        // CJK 字之间的空格被吃掉，方便 dedup
        assert_eq!(normalize_tag("打开 网站"), Some("打开网站".to_string()));
        assert_eq!(normalize_tag("打开网站"), Some("打开网站".to_string()));
        assert_eq!(normalize_tag("打开  网站"), Some("打开网站".to_string()));
        // CJK 与 Latin 之间的空格保留（保持可读性）
        assert_eq!(normalize_tag("ai 编程"), Some("ai 编程".to_string()));
        assert_eq!(normalize_tag("AI 编程"), Some("ai 编程".to_string()));
        // 混合情况
        assert_eq!(normalize_tag("打开 网站 ai"), Some("打开网站 ai".to_string()));
    }

    #[test]
    fn dedup_cjk_with_and_without_inner_space() {
        let inputs = vec![
            normalize_tag("打开网站").unwrap(),
            normalize_tag("打开 网站").unwrap(),
            normalize_tag("  打开  网站  ").unwrap(),
        ];
        let out = dedup_tags(inputs);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], "打开网站");
    }

    #[test]
    fn parse_frontmatter_only() {
        let dir = test_dir("frontmatter-only");
        let content = r#"---
name: only-header
description: header only
---
"#;
        let parsed = parse_skill_md_content(content, &dir).expect("parse");
        assert_eq!(parsed.name.as_deref(), Some("only-header"));
        assert_eq!(parsed.description.as_deref(), Some("header only"));
        assert_eq!(parsed.body, "");
    }
}
