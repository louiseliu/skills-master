use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;
use rusqlite::{params, Connection};
use serde::Deserialize;
use thiserror::Error;

use super::MarketplaceSkill;

#[derive(Debug, Error)]
pub enum ClawHubError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

const BASE_URL: &str = "https://clawhub.ai/api/v1";

fn http_client() -> Result<Client, reqwest::Error> {
    Client::builder()
        .user_agent("SkillsApp")
        .build()
}

/// Browse ClawHub skills with optional sort/direction/limit
pub fn fetch_clawhub(
    endpoint: &str,
    params_map: &HashMap<String, String>,
) -> Result<Vec<MarketplaceSkill>, ClawHubError> {
    let cache_key = format!("clawhub:{endpoint}:{params_map:?}");
    if let Some(cached) = read_cache(&cache_key)? {
        return Ok(cached);
    }

    let url = format!("{BASE_URL}/skills");
    let mut query: Vec<(String, String)> = Vec::new();

    // Map endpoint to sort params
    match endpoint {
        "downloads" | "top-downloads" => {
            query.push(("sort".into(), "downloads".into()));
            query.push(("dir".into(), "desc".into()));
        }
        "stars" => {
            query.push(("sort".into(), "stars".into()));
            query.push(("dir".into(), "desc".into()));
        }
        _ => {} // default server ordering
    }

    let limit = params_map
        .get("limit")
        .cloned()
        .unwrap_or_else(|| "50".into());
    query.push(("limit".into(), limit));

    // Forward any extra params
    for (k, v) in params_map {
        if k != "limit" {
            query.push((k.clone(), v.clone()));
        }
    }

    let resp = http_client()?
        .get(&url)
        .query(&query)
        .header("Accept", "application/json")
        .send()?
        .text()?;

    let skills = parse_skills_response(&resp);
    write_cache(&cache_key, &skills, 5 * 60)?;
    Ok(skills)
}

/// Search ClawHub skills
pub fn search_clawhub(query: &str) -> Result<Vec<MarketplaceSkill>, ClawHubError> {
    let cache_key = format!("clawhub:search:{query}");
    if let Some(cached) = read_cache(&cache_key)? {
        return Ok(cached);
    }

    let url = format!("{BASE_URL}/search");
    let resp = http_client()?
        .get(&url)
        .query(&[("q", query), ("limit", "50")])
        .header("Accept", "application/json")
        .send()?
        .text()?;

    let skills = parse_search_response(&resp);
    write_cache(&cache_key, &skills, 5 * 60)?;
    Ok(skills)
}

// ---------- Response parsing ----------

#[derive(Deserialize)]
struct SkillListResponse {
    #[serde(default)]
    items: Vec<SkillDTO>,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<SearchResultDTO>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillDTO {
    slug: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    summary: Option<String>,
    #[serde(default)]
    stats: Option<StatsDTO>,
}

#[derive(Deserialize)]
struct StatsDTO {
    #[serde(default)]
    downloads: Option<u64>,
    #[serde(default)]
    #[allow(dead_code)]
    stars: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResultDTO {
    slug: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    summary: Option<String>,
}

fn parse_skills_response(json_str: &str) -> Vec<MarketplaceSkill> {
    // Try SkillListResponse { items: [...] } first
    if let Ok(resp) = serde_json::from_str::<SkillListResponse>(json_str) {
        if !resp.items.is_empty() {
            return resp
                .items
                .into_iter()
                .map(|dto| MarketplaceSkill {
                    name: dto.display_name.unwrap_or_else(|| dto.slug.clone()),
                    description: dto.summary,
                    author: None,
                    repository: Some(format!("https://clawhub.ai/skills/{}", dto.slug)),
                    installs: dto.stats.and_then(|s| s.downloads),
                    source: "clawhub".to_string(),
                })
                .collect();
        }
    }
    // Fallback: try as raw array or { data: [...] }
    parse_clawhub_json_fallback(json_str)
}

fn parse_search_response(json_str: &str) -> Vec<MarketplaceSkill> {
    if let Ok(resp) = serde_json::from_str::<SearchResponse>(json_str) {
        return resp
            .results
            .into_iter()
            .map(|dto| MarketplaceSkill {
                name: dto.display_name.unwrap_or_else(|| dto.slug.clone()),
                description: dto.summary,
                author: None,
                repository: Some(format!("https://clawhub.ai/skills/{}", dto.slug)),
                installs: None,
                source: "clawhub".to_string(),
            })
            .collect();
    }
    Vec::new()
}

/// Fallback parser for unknown JSON shapes
fn parse_clawhub_json_fallback(payload: &str) -> Vec<MarketplaceSkill> {
    let json: serde_json::Value = serde_json::from_str(payload).unwrap_or_default();
    let list = if let Some(arr) = json.as_array() {
        arr.clone()
    } else if let Some(arr) = json.get("data").and_then(|v| v.as_array()) {
        arr.clone()
    } else {
        Vec::new()
    };

    list.into_iter()
        .map(|item| MarketplaceSkill {
            name: item
                .get("name")
                .or(item.get("displayName"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            description: item
                .get("summary")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            author: item
                .get("author")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            repository: item
                .get("repository")
                .or_else(|| item.get("repo"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
            installs: item
                .get("downloads")
                .or_else(|| item.get("installs"))
                .and_then(|v| v.as_u64()),
            source: "clawhub".to_string(),
        })
        .collect()
}

// ---------- SQLite cache ----------

fn cache_db_path() -> PathBuf {
    let base = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("skills-app");
    let _ = fs::create_dir_all(&base);
    base.join("marketplace.db")
}

fn open_cache() -> Result<Connection, ClawHubError> {
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

fn read_cache(key: &str) -> Result<Option<Vec<MarketplaceSkill>>, ClawHubError> {
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
) -> Result<(), ClawHubError> {
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
    fn parse_clawhub_items_response() {
        let payload = r#"{
          "items": [
            {"slug": "my-skill", "displayName": "My Skill", "summary": "A cool skill", "stats": {"downloads": 100, "stars": 5}},
            {"slug": "other", "summary": "Another one", "stats": {"downloads": 50}}
          ]
        }"#;
        let parsed = parse_skills_response(payload);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "My Skill");
        assert_eq!(parsed[0].description, Some("A cool skill".into()));
        assert_eq!(parsed[0].installs, Some(100));
        assert_eq!(parsed[1].name, "other");
    }

    #[test]
    fn parse_clawhub_search_response() {
        let payload = r#"{"results": [{"slug": "test-skill", "displayName": "Test", "summary": "desc"}]}"#;
        let parsed = parse_search_response(payload);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "Test");
    }

    #[test]
    fn parse_fallback_json() {
        let payload = r#"{
          "data": [
            {"name": "skill-a", "author": "acme", "repository": "https://github.com/acme/skill-a", "downloads": 100},
            {"name": "skill-b", "author": "demo", "repo": "https://github.com/demo/skill-b", "installs": 50}
          ]
        }"#;
        let parsed = parse_clawhub_json_fallback(payload);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].name, "skill-a");
        assert_eq!(parsed[1].installs, Some(50));
    }
}
