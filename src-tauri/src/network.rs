use reqwest::blocking::Client;
use std::time::Duration;

use crate::commands::settings::{read_settings, NetworkConfig};

/// 默认 GitHub 加速前缀（开启加速但未自定义时使用）
pub const DEFAULT_GITHUB_PROXY: &str = "https://ghproxy.com/";

/// 读取网络配置（出错时返回 None）
pub fn current_network_config() -> Option<NetworkConfig> {
    read_settings().ok().and_then(|s| s.network)
}

/// 应用代理配置到 reqwest::blocking::ClientBuilder
fn apply_proxy(builder: reqwest::blocking::ClientBuilder, cfg: &NetworkConfig) -> reqwest::blocking::ClientBuilder {
    if !cfg.proxy_enabled {
        return builder;
    }
    let url = match cfg.proxy_url.as_deref() {
        Some(u) if !u.trim().is_empty() => u.trim().to_string(),
        _ => return builder,
    };
    match reqwest::Proxy::all(&url) {
        Ok(proxy) => builder.proxy(proxy),
        Err(e) => {
            eprintln!("[network] invalid proxy url '{url}': {e}");
            builder
        }
    }
}

/// 通用阻塞 HTTP 客户端：自动应用代理 + 默认 UA + 30s 超时。
pub fn build_blocking_client(user_agent: &str) -> Result<Client, reqwest::Error> {
    let mut builder = Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(30));
    if let Some(cfg) = current_network_config() {
        builder = apply_proxy(builder, &cfg);
    }
    builder.build()
}

/// 自定义超时的阻塞 HTTP 客户端
pub fn build_blocking_client_with_timeout(user_agent: &str, timeout: Duration) -> Result<Client, reqwest::Error> {
    let mut builder = Client::builder().user_agent(user_agent).timeout(timeout);
    if let Some(cfg) = current_network_config() {
        builder = apply_proxy(builder, &cfg);
    }
    builder.build()
}

/// 异步 HTTP 客户端构造（用于 SSE 等场景，自动应用代理）。
pub fn build_async_client(user_agent: &str) -> Result<reqwest::Client, reqwest::Error> {
    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(120));
    if let Some(cfg) = current_network_config() {
        if cfg.proxy_enabled {
            if let Some(url) = cfg.proxy_url.as_deref().and_then(|u| {
                let t = u.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(t.to_string())
                }
            }) {
                match reqwest::Proxy::all(&url) {
                    Ok(proxy) => builder = builder.proxy(proxy),
                    Err(e) => eprintln!("[network] invalid async proxy url '{url}': {e}"),
                }
            }
        }
    }
    builder.build()
}

/// 把可加速的 GitHub URL 包装成代理形式。仅当 cfg.github_proxy_enabled 时生效，
/// 且仅匹配 https://github.com/... 与 https://raw.githubusercontent.com/...
pub fn accelerate_github_url(url: &str) -> String {
    let cfg = match current_network_config() {
        Some(c) if c.github_proxy_enabled => c,
        _ => return url.to_string(),
    };
    if !is_github_url(url) {
        return url.to_string();
    }
    let prefix = cfg
        .github_proxy_prefix
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_GITHUB_PROXY);
    let prefix = prefix.trim_end_matches('/');
    format!("{prefix}/{url}")
}

fn is_github_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
        || url.starts_with("http://github.com/")
        || url.starts_with("https://raw.githubusercontent.com/")
        || url.starts_with("http://raw.githubusercontent.com/")
}
