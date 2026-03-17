use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use reqwest::blocking::Client;
use rusqlite::{params, Connection};
use serde::Deserialize;
use thiserror::Error;

use super::MarketplaceSkill;

#[derive(Debug, Error)]
pub enum SkillsShError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

/// JSON shape embedded in Next.js RSC payload for each skill
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RscSkill {
    source: String,
    skill_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    installs: Option<u64>,
}

/// Fetch leaderboard from skills.sh by scraping the RSC payload in the HTML
pub fn fetch_skillssh(sort: &str, page: u32) -> Result<Vec<MarketplaceSkill>, SkillsShError> {
    let cache_key = format!("skills.sh:{sort}:{page}");
    if let Some(cached) = read_cache(&cache_key)? {
        return Ok(cached);
    }

    let url = match sort {
        "trending" => format!("https://skills.sh/trending?page={page}"),
        "hot" => format!("https://skills.sh/hot?page={page}"),
        _ => format!("https://skills.sh/?page={page}"),
    };
    let html = Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()?
        .get(&url)
        .send()?
        .text()?;

    let skills = parse_leaderboard_html(&html);
    write_cache(&cache_key, &skills, 5 * 60)?;
    Ok(skills)
}

/// Search skills.sh using the JSON search API
pub fn search_skillssh(query: &str) -> Result<Vec<MarketplaceSkill>, SkillsShError> {
    let cache_key = format!("skills.sh:search:{query}");
    if let Some(cached) = read_cache(&cache_key)? {
        return Ok(cached);
    }

    let url = format!(
        "https://skills.sh/api/search?q={}&limit=50",
        urlencoding::encode(query)
    );
    let resp = Client::builder()
        .user_agent("Mozilla/5.0")
        .build()?
        .get(&url)
        .header("Accept", "application/json")
        .send()?
        .text()?;

    let skills = parse_search_response(&resp);
    write_cache(&cache_key, &skills, 5 * 60)?;
    Ok(skills)
}

/// Parse skills.sh search API JSON response
fn parse_search_response(json_str: &str) -> Vec<MarketplaceSkill> {
    #[derive(Deserialize)]
    struct SearchResponse {
        #[serde(default)]
        skills: Vec<SearchSkill>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SearchSkill {
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        skill_id: Option<String>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        installs: Option<u64>,
    }

    let parsed: SearchResponse = serde_json::from_str(json_str).unwrap_or(SearchResponse {
        skills: Vec::new(),
    });

    parsed
        .skills
        .into_iter()
        .filter_map(|s| {
            let source_path = s.source?;
            let skill_id = s.skill_id?;
            let parts: Vec<&str> = source_path.splitn(2, '/').collect();
            let owner = if parts.len() == 2 {
                parts[0]
            } else {
                source_path.as_str()
            };
            Some(MarketplaceSkill {
                name: s.name.unwrap_or_else(|| skill_id.clone()),
                description: None,
                author: Some(owner.to_string()),
                repository: Some(format!("https://github.com/{source_path}")),
                installs: s.installs,
                source: "skills.sh".to_string(),
            })
        })
        .collect()
}

/// Extract skill data from Next.js RSC payload embedded in HTML.
///
/// Next.js App Router with React Server Components embeds data in
/// `self.__next_f.push()` script tags. We find JSON objects with
/// `skillId` and `installs` fields using regex.
fn parse_leaderboard_html(html: &str) -> Vec<MarketplaceSkill> {
    // Match flat JSON objects containing both "skillId" and "installs"
    let pattern =
        r#"\{[^}]*"skillId"\s*:\s*"[^"]+"[^}]*"installs"\s*:\s*\d+[^}]*\}"#;
    let re = Regex::new(pattern).expect("regex");

    let mut skills: Vec<MarketplaceSkill> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // First pass: match unescaped JSON objects
    for m in re.find_iter(html) {
        if let Some(skill) = try_decode_rsc_skill(m.as_str()) {
            if seen.insert(skill.name.clone()) {
                skills.push(skill);
            }
        }
    }

    // Second pass: search in escaped JSON strings inside __next_f.push() payloads
    if skills.is_empty() {
        let escaped_pattern =
            r#"\{(?:[^{}]|\\[{}])*\\?"skillId\\?"\s*:\\?\s*\\?"[^"\\]+\\?"[^}]*\}"#;
        if let Ok(esc_re) = Regex::new(escaped_pattern) {
            for m in esc_re.find_iter(html) {
                let unescaped = m
                    .as_str()
                    .replace("\\\"", "\"")
                    .replace("\\\\/", "/")
                    .replace("\\\\", "\\");
                if let Some(skill) = try_decode_rsc_skill(&unescaped) {
                    if seen.insert(skill.name.clone()) {
                        skills.push(skill);
                    }
                }
            }
        }
    }

    skills
}

/// Try to decode a JSON string as an RscSkill and convert to MarketplaceSkill
fn try_decode_rsc_skill(json_str: &str) -> Option<MarketplaceSkill> {
    let rsc: RscSkill = serde_json::from_str(json_str).ok()?;
    let parts: Vec<&str> = rsc.source.splitn(2, '/').collect();
    let owner = if parts.len() == 2 {
        parts[0]
    } else {
        rsc.source.as_str()
    };
    Some(MarketplaceSkill {
        name: rsc.name.unwrap_or_else(|| rsc.skill_id.clone()),
        description: None,
        author: Some(owner.to_string()),
        repository: Some(format!("https://github.com/{}", rsc.source)),
        installs: rsc.installs,
        source: "skills.sh".to_string(),
    })
}

// ---------- SQLite cache ----------

fn cache_db_path() -> PathBuf {
    let base = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("skills-app");
    let _ = fs::create_dir_all(&base);
    base.join("marketplace.db")
}

fn open_cache() -> Result<Connection, SkillsShError> {
    let conn = Connection::open(cache_db_path())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS marketplace_cache (
            cache_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )",
        [],
    )?;
    Ok(conn)
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock drift")
        .as_secs() as i64
}

fn read_cache(key: &str) -> Result<Option<Vec<MarketplaceSkill>>, SkillsShError> {
    let conn = open_cache()?;
    let mut stmt =
        conn.prepare("SELECT payload, expires_at FROM marketplace_cache WHERE cache_key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let payload: String = row.get(0)?;
    let expires_at: i64 = row.get(1)?;
    if expires_at < now_epoch() {
        return Ok(None);
    }
    let parsed: Vec<MarketplaceSkill> = serde_json::from_str(&payload).unwrap_or_default();
    Ok(Some(parsed))
}

fn write_cache(
    key: &str,
    skills: &[MarketplaceSkill],
    ttl_seconds: i64,
) -> Result<(), SkillsShError> {
    let conn = open_cache()?;
    let payload = serde_json::to_string(skills).unwrap_or_default();
    conn.execute(
        "INSERT INTO marketplace_cache(cache_key, payload, expires_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload=excluded.payload,
           expires_at=excluded.expires_at",
        params![key, payload, now_epoch() + ttl_seconds],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rsc_payload() {
        // Simulate RSC payload with embedded skill JSON objects
        let html = r#"<script>self.__next_f.push([1,"something {\"source\":\"acme/skill-repo\",\"skillId\":\"my-skill\",\"name\":\"My Skill\",\"installs\":1200} more"])</script>
        <script>self.__next_f.push([1,"{\"source\":\"demo/repo\",\"skillId\":\"other-skill\",\"name\":\"Other\",\"installs\":500}"])</script>"#;
        let skills = parse_leaderboard_html(html);
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].name, "My Skill");
        assert_eq!(skills[0].installs, Some(1200));
        assert_eq!(skills[0].author, Some("acme".to_string()));
        assert_eq!(
            skills[0].repository,
            Some("https://github.com/acme/skill-repo".to_string())
        );
        assert_eq!(skills[1].name, "Other");
    }

    #[test]
    fn parse_search_json() {
        let json = r#"{"skills":[{"source":"vercel-labs/skills","skillId":"find-skills","name":"find-skills","installs":565200}]}"#;
        let skills = parse_search_response(json);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "find-skills");
        assert_eq!(skills[0].author, Some("vercel-labs".to_string()));
    }
}
