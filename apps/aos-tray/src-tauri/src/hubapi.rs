//! A small client for the AOS hub's HTTP API on 127.0.0.1 (lib/hub). The app talks to the hub
//! from Rust so that the hub token never reaches the webview or any log.
//!
//! The hub's guard (lib/hub/guard.mjs): Host must be exactly 127.0.0.1:<port>; mutations are
//! POST with Content-Type application/json, the header `x-aos-hub-token`, a typed `confirm` field
//! and a body of at most 8 KB. The token is created on every hub start and is only embedded in
//! the hub page as `<meta name="aos-hub-token" content="...">`, so it is fetched from `GET /`.
//!
//! Only plain HTTP/1.1 with `Connection: close` is spoken; the parsing helpers are pure.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const MAX_BODY: usize = 8 * 1024;
const MAX_RESPONSE: usize = 8 * 1024 * 1024;

/// Store names: lib/store-shared.mjs STORE_NAME_RE.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Kinds the app installs from the store. MCP servers go through the gateway screen.
pub fn valid_kind(kind: &str) -> bool {
    matches!(kind, "skill" | "agent")
}

/// Splits a raw HTTP/1.1 response into (status, body). Understands Content-Length and chunked.
pub fn parse_response(raw: &[u8]) -> Result<(u16, Vec<u8>), String> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or_else(|| "incomplete response from the hub".to_string())?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|_| "unreadable response head".to_string())?;
    let body = &raw[split + 4..];
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let status: u16 = status_line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).ok_or_else(|| "bad status line".to_string())?;
    let chunked = lines.any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    let declared: Option<usize> = head.split("\r\n").skip(1).find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.trim().eq_ignore_ascii_case("content-length").then(|| v.trim().parse().ok()).flatten()
    });
    let body = if chunked { dechunk(body)? } else { body.to_vec() };
    if let (false, Some(n)) = (chunked, declared) {
        if body.len() < n {
            return Err("the hub response was cut off".into());
        }
    }
    Ok((status, body))
}

/// Decodes a chunked body. Strict enough to reject garbage, not a general HTTP parser.
pub fn dechunk(mut data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let eol = data.windows(2).position(|w| w == b"\r\n").ok_or_else(|| "bad chunk framing".to_string())?;
        let size_text = std::str::from_utf8(&data[..eol]).map_err(|_| "bad chunk size".to_string())?;
        let size_text = size_text.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16).map_err(|_| "bad chunk size".to_string())?;
        data = &data[eol + 2..];
        if size == 0 {
            return Ok(out);
        }
        let need = size.checked_add(2).ok_or_else(|| "bad chunk size".to_string())?;
        if data.len() < need {
            return Err("truncated chunk".into());
        }
        out.extend_from_slice(&data[..size]);
        data = &data[need..];
    }
}

/// The token from the hub page. Looks for the meta tag and reads its `content` value.
pub fn extract_token(html: &str) -> Option<String> {
    let at = html.find("name=\"aos-hub-token\"")?;
    let tag_start = html[..at].rfind('<')?;
    let tag_end = at + html[at..].find('>')?;
    let tag = &html[tag_start..tag_end];
    let c = tag.find("content=\"")? + "content=\"".len();
    let value = &tag[c..];
    let end = value.find('"')?;
    let token = &value[..end];
    (!token.is_empty() && token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).then(|| token.to_string())
}

fn request_bytes(port: u16, method: &str, path: &str, token: Option<&str>, body: Option<&str>) -> Vec<u8> {
    let mut s = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nAccept: application/json, text/html\r\n");
    if let Some(t) = token {
        s.push_str(&format!("x-aos-hub-token: {t}\r\n"));
    }
    if let Some(b) = body {
        s.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", b.len()));
    }
    s.push_str("\r\n");
    if let Some(b) = body {
        s.push_str(b);
    }
    s.into_bytes()
}

fn send(port: u16, method: &str, path: &str, token: Option<&str>, body: Option<&str>) -> Result<(u16, Vec<u8>), String> {
    if let Some(b) = body {
        if b.len() > MAX_BODY {
            return Err("request body too large".into());
        }
    }
    // Overall deadline: reads are short, installs (POST) may legitimately take minutes.
    let budget = if method == "GET" { Duration::from_secs(30) } else { Duration::from_secs(20 * 60) };
    let deadline = std::time::Instant::now() + budget;
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).map_err(|e| format!("hub not reachable: {e}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok();
    stream.write_all(&request_bytes(port, method, path, token, body)).map_err(|e| format!("hub write failed: {e}"))?;
    let mut raw = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        if std::time::Instant::now() > deadline {
            return Err("the hub did not finish in time; it may still be working, refresh to check".into());
        }
        match stream.read(&mut buf) {
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Ok(0) => break,
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                if raw.len() > MAX_RESPONSE {
                    return Err("hub response too large".into());
                }
            }
            Err(e) => return Err(format!("hub read failed: {e}")),
        }
    }
    parse_response(&raw)
}

/// Fetches the hub token from the hub page (a new token on every hub start).
pub fn fetch_token(port: u16) -> Result<String, String> {
    let (status, body) = send(port, "GET", "/", None, None)?;
    if status != 200 {
        return Err(format!("hub page answered {status}"));
    }
    extract_token(&String::from_utf8_lossy(&body)).ok_or_else(|| "hub page carries no token".to_string())
}

pub fn get_json(port: u16, path: &str) -> Result<Value, String> {
    let (status, body) = send(port, "GET", path, None, None)?;
    let v: Value = serde_json::from_slice(&body).map_err(|_| format!("hub answered {status} without JSON"))?;
    if status >= 400 {
        return Err(v.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("hub answered {status}")));
    }
    Ok(v)
}

/// POST with the token. A stale token (401/403 after a hub restart) is refetched once.
pub fn post_json(port: u16, cached: &mut Option<String>, path: &str, body: &Value) -> Result<Value, String> {
    let text = body.to_string();
    for attempt in 0..2 {
        if cached.is_none() {
            *cached = Some(fetch_token(port)?);
        }
        let (status, resp) = send(port, "POST", path, cached.as_deref(), Some(&text))?;
        if (status == 401 || status == 403) && attempt == 0 {
            *cached = None;
            continue;
        }
        let v: Value = serde_json::from_slice(&resp).unwrap_or(Value::Null);
        if status >= 400 {
            return Err(v.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("hub answered {status}")));
        }
        return Ok(v);
    }
    Err("the hub refused the token".into())
}

// ------------------------------------------------------------------ store catalog

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct StoreItem {
    pub name: String,
    pub kind: String,
    pub description: String,
    pub category: String,
    pub source: String,
    pub installed: bool,
    pub core: bool,
    pub third_party: bool,
    pub requires_auth: bool,
    pub problem: String,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct PackageRow {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct StoreCatalog {
    pub items: Vec<StoreItem>,
    pub packages: Vec<PackageRow>,
}

#[derive(Deserialize)]
struct RawItem {
    name: String,
    kind: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    installed: bool,
    #[serde(default)]
    core: bool,
    #[serde(default, rename = "thirdParty")]
    third_party: bool,
    #[serde(default, rename = "requiresAuth")]
    requires_auth: bool,
    #[serde(default)]
    problem: String,
}

/// `GET /api/store` -> the slim catalog the screen needs (descriptions capped, no file lists).
pub fn parse_catalog(v: &Value) -> StoreCatalog {
    let mut items: Vec<StoreItem> = v
        .get("items")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| serde_json::from_value::<RawItem>(x.clone()).ok())
                .filter(|r| valid_name(&r.name) && valid_kind(&r.kind))
                .map(|r| StoreItem {
                    description: r.description.chars().take(400).collect(),
                    name: r.name,
                    kind: r.kind,
                    category: r.category,
                    source: r.source,
                    installed: r.installed,
                    core: r.core,
                    third_party: r.third_party,
                    requires_auth: r.requires_auth,
                    problem: r.problem,
                })
                .collect()
        })
        .unwrap_or_default();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let packages = v
        .get("packages")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    Some(PackageRow {
                        id: p.get("id")?.as_str()?.to_string(),
                        name: p.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                        installed: p.get("installed").and_then(Value::as_bool).unwrap_or(false),
                        version: p.get("version").and_then(Value::as_str).map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    StoreCatalog { items, packages }
}

/// Body of `POST /api/store/install` and `/rollback`: the typed `confirm` is the item name.
pub fn install_body(kind: &str, name: &str) -> Result<Value, String> {
    if !valid_kind(kind) || !valid_name(name) {
        return Err("invalid store item".into());
    }
    Ok(json!({ "kind": kind, "name": name, "scope": "global", "confirm": name }))
}

pub fn rollback_body(name: &str) -> Result<Value, String> {
    if !valid_name(name) {
        return Err("invalid store item".into());
    }
    Ok(json!({ "name": name, "scope": "global", "confirm": name }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_kinds_are_strict() {
        assert!(valid_name("pb-tauri_e2e"));
        for bad in ["", "a b", "../x", "a/b", "x;y", "é"] {
            assert!(!valid_name(bad), "{bad:?}");
        }
        assert!(!valid_name(&"a".repeat(101)));
        assert!(valid_kind("skill") && valid_kind("agent") && !valid_kind("mcp") && !valid_kind(""));
    }

    #[test]
    fn parses_content_length_and_chunked_responses() {
        let plain = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}";
        assert_eq!(parse_response(plain).unwrap(), (200, b"{}".to_vec()));
        let chunked = b"HTTP/1.1 201 Created\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n";
        assert_eq!(parse_response(chunked).unwrap(), (201, b"abcde".to_vec()));
        assert!(parse_response(b"HTTP/1.1 200 OK\r\n").is_err());
        assert!(parse_response(b"garbage\r\n\r\nbody").is_err());
        assert!(dechunk(b"zz\r\nabc\r\n0\r\n\r\n").is_err());
        assert!(dechunk(b"5\r\nab").is_err());
        assert!(dechunk(b"ffffffffffffffff\r\nab\r\n").is_err(), "a huge chunk size must not overflow");
        let cut = b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n{}";
        assert!(parse_response(cut).unwrap_err().contains("cut off"));
    }

    #[test]
    fn token_comes_from_the_meta_tag_only() {
        let html = "<head><meta charset=\"utf-8\"><meta name=\"aos-hub-token\" content=\"AbC-123_x\"></head>";
        assert_eq!(extract_token(html).as_deref(), Some("AbC-123_x"));
        assert_eq!(extract_token("<meta name=\"other\" content=\"x\">"), None);
        assert_eq!(extract_token("<meta name=\"aos-hub-token\" content=\"\">"), None);
        assert_eq!(extract_token("<meta name=\"aos-hub-token\" content=\"a b\">"), None);
        assert_eq!(extract_token("<meta name=\"aos-hub-token\">"), None);
    }

    #[test]
    fn request_carries_host_token_and_length() {
        let r = String::from_utf8(request_bytes(7900, "POST", "/api/store/install", Some("tok"), Some("{\"a\":1}"))).unwrap();
        assert!(r.starts_with("POST /api/store/install HTTP/1.1\r\nHost: 127.0.0.1:7900\r\n"));
        assert!(r.contains("x-aos-hub-token: tok\r\n"));
        assert!(r.contains("Content-Length: 7\r\n"));
        assert!(r.ends_with("\r\n\r\n{\"a\":1}"));
        let g = String::from_utf8(request_bytes(7900, "GET", "/", None, None)).unwrap();
        assert!(!g.contains("x-aos-hub-token"));
    }

    #[test]
    fn oversized_body_is_refused_before_connecting() {
        let big = "x".repeat(MAX_BODY + 1);
        assert!(send(9, "POST", "/x", Some("t"), Some(&big)).unwrap_err().contains("too large"));
    }

    #[test]
    fn catalog_is_slimmed_and_sorted() {
        let v = json!({
            "items": [
                { "name": "zeta", "kind": "skill", "description": "d", "installed": true, "core": true },
                { "name": "Alpha", "kind": "agent", "thirdParty": true, "requiresAuth": true, "problem": "x" },
                { "name": "bad name", "kind": "skill" },
                { "name": "an-mcp", "kind": "mcp" },
                { "kind": "skill" }
            ],
            "packages": [ { "id": "memb", "name": "memB", "installed": true, "version": "2.4.1" }, { "name": "no id" } ]
        });
        let c = parse_catalog(&v);
        assert_eq!(c.items.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["Alpha", "zeta"]);
        assert!(c.items[0].third_party && c.items[0].requires_auth && !c.items[0].installed);
        assert!(c.items[1].installed && c.items[1].core);
        assert_eq!(c.packages, vec![PackageRow { id: "memb".into(), name: "memB".into(), installed: true, version: Some("2.4.1".into()) }]);
        assert_eq!(parse_catalog(&json!({})), StoreCatalog::default());
    }

    /// Needs a running hub (`aos-hub start --no-open`); run with `cargo test --lib live -- --ignored`.
    /// Reads only: it fetches the token and the catalog and prints counts, never the token.
    #[test]
    #[ignore]
    fn live_hub_catalog_and_token() {
        let port = 7900;
        let token = fetch_token(port).expect("token");
        assert!(token.len() >= 16, "token looks too short");
        let c = parse_catalog(&get_json(port, "/api/store?scope=global").expect("catalog"));
        println!("items={} packages={}", c.items.len(), c.packages.len());
        assert!(!c.items.is_empty());
    }

    #[test]
    fn mutation_bodies_confirm_with_the_name() {
        let b = install_body("skill", "demo").unwrap();
        assert_eq!(b["confirm"], "demo");
        assert_eq!(b["scope"], "global");
        assert!(install_body("mcp", "x").is_err());
        assert!(install_body("skill", "a b").is_err());
        assert_eq!(rollback_body("demo").unwrap()["confirm"], "demo");
        assert!(rollback_body("../x").is_err());
    }
}
