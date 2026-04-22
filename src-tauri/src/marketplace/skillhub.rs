use reqwest::blocking::Client;
use serde::Deserialize;
use thiserror::Error;

use super::cache::{read_cache, read_cache_stale, write_cache};
use super::MarketplaceSkill;

#[derive(Debug, Error)]
pub enum SkillHubError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

const BASE_URL: &str = "https://api.skillhub.cn/api/v1";

fn http_client() -> Result<Client, reqwest::Error> {
    Client::builder()
        .user_agent("SkillsMaster/1.0")
        .build()
}

/// Fetch showcase listing from SkillHub (e.g. "hot" for hot_downloads)
pub fn fetch_skillhub(section: &str) -> Result<Vec<MarketplaceSkill>, SkillHubError> {
    let cache_key = format!("skillhub:{section}");
    if let Ok(Some(cached)) = read_cache(&cache_key) {
        return Ok(cached);
    }

    let url = format!("{BASE_URL}/showcase/{section}");
    let result = http_client()?
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .and_then(|r| r.text());

    match result {
        Ok(resp) => {
            let skills = parse_showcase_response(&resp);
            let _ = write_cache(&cache_key, &skills, 5 * 60);
            Ok(skills)
        }
        Err(e) => {
            if let Ok(Some(stale)) = read_cache_stale(&cache_key) {
                return Ok(stale);
            }
            Err(SkillHubError::Network(e))
        }
    }
}

/// Client-side search: fetch the hot showcase and filter by query string.
/// SkillHub does not expose a dedicated search API.
pub fn search_skillhub(query: &str) -> Result<Vec<MarketplaceSkill>, SkillHubError> {
    let cache_key = format!("skillhub:search:{query}");
    if let Ok(Some(cached)) = read_cache(&cache_key) {
        return Ok(cached);
    }

    let all = fetch_skillhub("hot")?;
    let q = query.to_lowercase();
    let results: Vec<MarketplaceSkill> = all
        .into_iter()
        .filter(|s| {
            s.name.to_lowercase().contains(&q)
                || s.description
                    .as_deref()
                    .map(|d| d.to_lowercase().contains(&q))
                    .unwrap_or(false)
                || s.author
                    .as_deref()
                    .map(|a| a.to_lowercase().contains(&q))
                    .unwrap_or(false)
        })
        .collect();
    let _ = write_cache(&cache_key, &results, 2 * 60);
    Ok(results)
}

#[derive(Deserialize)]
struct ShowcaseResponse {
    #[serde(default)]
    skills: Vec<ShowcaseSkill>,
}

#[derive(Deserialize)]
struct ShowcaseSkill {
    #[serde(default)]
    slug: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    description_zh: Option<String>,
    #[serde(default, rename = "ownerName")]
    owner_name: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    downloads: Option<u64>,
    #[serde(default)]
    installs: Option<u64>,
}

fn parse_showcase_response(json_str: &str) -> Vec<MarketplaceSkill> {
    let resp: ShowcaseResponse =
        serde_json::from_str(json_str).unwrap_or(ShowcaseResponse { skills: Vec::new() });

    resp.skills
        .into_iter()
        .map(|s| {
            let display_name = s.name.unwrap_or_else(|| s.slug.clone());
            let desc = s.description_zh.or(s.description);
            let repo = s
                .homepage
                .or_else(|| Some(format!("https://skillhub.cn/skills/{}", s.slug)));
            MarketplaceSkill {
                name: display_name,
                description: desc,
                author: s.owner_name,
                repository: repo,
                installs: s.downloads.or(s.installs),
                source: "skillhub".to_string(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_showcase_json() {
        let payload = r#"{"section":"hot_downloads","skills":[{"slug":"my-skill","name":"My Skill","description":"A cool skill","description_zh":"一个很酷的技能","ownerName":"acme","homepage":"https://clawhub.ai/acme/my-skill","downloads":100,"installs":50}],"total":1}"#;
        let skills = parse_showcase_response(payload);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "My Skill");
        assert_eq!(skills[0].description, Some("一个很酷的技能".into()));
        assert_eq!(skills[0].author, Some("acme".into()));
        assert_eq!(skills[0].installs, Some(100));
        assert_eq!(skills[0].source, "skillhub");
    }

    #[test]
    fn parse_showcase_fallback_no_homepage() {
        let payload = r#"{"section":"hot","skills":[{"slug":"test-skill","name":"Test","downloads":42}],"total":1}"#;
        let skills = parse_showcase_response(payload);
        assert_eq!(skills.len(), 1);
        assert_eq!(
            skills[0].repository,
            Some("https://skillhub.cn/skills/test-skill".into())
        );
    }
}
