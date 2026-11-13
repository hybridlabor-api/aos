//! Read-only views of the files and JSON outputs the AOS CLIs produce. Every parser here is
//! pure (text in, struct out) so it can be unit tested without AOS installed.
//! Sources: lib/update-check.js (versions cache, isNewer), lib/v5/profile.js (v5-settings),
//! lib/hub/services.mjs (services status --json), bin/aos-gateway.mjs (status --json),
//! bin/aos-doctor.mjs (--json), bin/aos-hub.mjs (hub.json).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const AOS_PKG: &str = "@hybridlabor-api/aos";

pub fn package_root_record(home: &Path) -> PathBuf {
    home.join(".agents").join("lib").join(".aos-package-root.json")
}
pub fn versions_cache(home: &Path) -> PathBuf {
    home.join(".aos").join("cache").join("versions.json")
}
pub fn v5_settings(home: &Path) -> PathBuf {
    home.join(".aos").join("v5-settings.json")
}
pub fn manifest(home: &Path) -> PathBuf {
    home.join(".agents").join(".bdb-manifest.json")
}
pub fn hub_json(home: &Path) -> PathBuf {
    home.join(".aos").join("hub").join("hub.json")
}
pub fn global_agents_md(home: &Path) -> PathBuf {
    // installer.js syncs managed blocks into ~/AGENTS.md (homeAgentsPath).
    home.join("AGENTS.md")
}
pub fn skills_dir(home: &Path) -> PathBuf {
    home.join(".agents").join("skills")
}

fn strip_bom(t: &str) -> &str {
    t.strip_prefix('\u{feff}').unwrap_or(t)
}

/// `{ "packageRoot": "<dir>" }` written by installer.js (writeA2aPackageRootRecord).
pub fn parse_package_root(text: &str) -> Option<PathBuf> {
    let v: Value = serde_json::from_str(strip_bom(text)).ok()?;
    let s = v.get("packageRoot")?.as_str()?;
    if s.is_empty() {
        return None;
    }
    Some(PathBuf::from(s))
}

/// `{ "version": "x.y.z" }` from a package.json or the manifest.
pub fn parse_version_field(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(strip_bom(text)).ok()?;
    v.get("version")?.as_str().map(str::to_string)
}

/// ~/.aos/cache/versions.json: `{ "@hybridlabor-api/aos": { "v": "5.4.8", "t": <ms> } }`.
pub fn parse_latest_cached(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(strip_bom(text)).ok()?;
    let s = v.get(AOS_PKG)?.get("v")?.as_str()?;
    if s == "unknown" {
        return None;
    }
    Some(s.to_string())
}

#[derive(Debug, PartialEq)]
enum Part {
    Num(u64),
    Str(String),
}

fn parse_semver(v: &str) -> (Vec<u64>, Option<Vec<Part>>) {
    let (main, pre) = match v.find('-') {
        Some(i) => (&v[..i], Some(&v[i + 1..])),
        None => (v, None),
    };
    let main = main.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect();
    let pre = pre.map(|p| {
        p.split('.')
            .map(|x| x.parse::<u64>().map(Part::Num).unwrap_or_else(|_| Part::Str(x.to_string())))
            .collect()
    });
    (main, pre)
}

/// Port of isNewerVersion (lib/update-check.js).
pub fn is_newer_version(local: &str, remote: &str) -> bool {
    if local.is_empty() || remote.is_empty() || local == remote {
        return false;
    }
    let (lm, lp) = parse_semver(local);
    let (rm, rp) = parse_semver(remote);
    for i in 0..lm.len().max(rm.len()) {
        let (a, b) = (lm.get(i).copied().unwrap_or(0), rm.get(i).copied().unwrap_or(0));
        if b > a {
            return true;
        }
        if a > b {
            return false;
        }
    }
    match (lp, rp) {
        (None, Some(_)) | (None, None) => false,
        (Some(_), None) => true,
        (Some(l), Some(r)) => {
            for i in 0..l.len().max(r.len()) {
                match (l.get(i), r.get(i)) {
                    (_, None) => return false,
                    (None, Some(_)) => return true,
                    (Some(Part::Num(a)), Some(Part::Num(b))) if a != b => return b > a,
                    (Some(Part::Str(a)), Some(Part::Str(b))) if a != b => return b > a,
                    (Some(Part::Num(_)), Some(Part::Str(_))) => return true,
                    (Some(Part::Str(_)), Some(Part::Num(_))) => return false,
                    _ => {}
                }
            }
            false
        }
    }
}

fn channel(v: &str) -> Option<String> {
    let pre = &v[v.find('-')? + 1..];
    let letters: String = pre.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    if letters.is_empty() {
        Some(pre.split('.').next().unwrap_or("").to_lowercase())
    } else {
        Some(letters.to_lowercase())
    }
}

/// Port of isNewer (lib/update-check.js): prereleases only count on the same channel.
pub fn is_update_available(installed: &str, latest: &str) -> bool {
    if installed.is_empty() || latest.is_empty() || latest == "unknown" || installed == latest {
        return false;
    }
    let ic = channel(installed);
    let lc = channel(latest);
    if ic.is_some() && lc.is_none() {
        let base = &installed[..installed.find('-').unwrap_or(installed.len())];
        if !is_newer_version(latest, base) {
            return true;
        }
    }
    if lc.is_some() && ic != lc {
        return false;
    }
    is_newer_version(installed, latest)
}

/// The fields of ~/.aos/v5-settings.json the tray shows (lib/v5/profile.js sanitizeSettings).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct SettingsView {
    pub profile: Option<String>,
    pub disabled: Vec<String>,
    pub updates: Option<String>,
    pub valid: bool,
}

pub fn parse_v5_settings(text: &str) -> SettingsView {
    let Ok(v) = serde_json::from_str::<Value>(strip_bom(text)) else {
        return SettingsView::default();
    };
    if !v.is_object() {
        return SettingsView::default();
    }
    SettingsView {
        profile: v.get("profile").and_then(Value::as_str).map(str::to_string),
        disabled: v
            .get("disabled")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        updates: v.get("updates").and_then(Value::as_str).map(str::to_string),
        valid: true,
    }
}

/// Only the port from hub.json; the token in that file is never read into a struct.
pub fn parse_hub_port(text: &str) -> Option<u16> {
    #[derive(Deserialize)]
    struct Hub {
        port: Option<u16>,
    }
    serde_json::from_str::<Hub>(strip_bom(text)).ok()?.port
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Service {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub up: Option<bool>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

/// `aos services status --json` prints `{ "services": [ ... ] }`.
pub fn parse_services(stdout: &str) -> Result<Vec<Service>, String> {
    #[derive(Deserialize)]
    struct Out {
        services: Vec<Service>,
    }
    serde_json::from_str::<Out>(json_slice(stdout)).map(|o| o.services).map_err(|e| format!("unexpected services output: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Upstream {
    pub name: String,
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub busy: bool,
    #[serde(default)]
    pub degraded: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GatewayStatus {
    #[serde(default)]
    pub running: bool,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub upstreams: Vec<Upstream>,
}

/// `aos-gateway status --json` (exit 1 when not running, JSON still printed).
pub fn parse_gateway(stdout: &str) -> Result<GatewayStatus, String> {
    serde_json::from_str(json_slice(stdout)).map_err(|e| format!("unexpected gateway output: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DoctorResult {
    #[serde(default)]
    pub area: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub detail: Option<Value>,
    #[serde(default)]
    pub fix: Option<Value>,
    #[serde(default, rename = "warningOnly")]
    pub warning_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Doctor {
    pub ok: bool,
    #[serde(default)]
    pub results: Vec<DoctorResult>,
}

/// `aos doctor --json` prints `{ ok, platform, arch, results }`.
pub fn parse_doctor(stdout: &str) -> Result<Doctor, String> {
    serde_json::from_str(json_slice(stdout)).map_err(|e| format!("unexpected doctor output: {e}"))
}

/// A CLI may print a warning line before its JSON: take from the first `{` to the last `}`.
pub fn json_slice(s: &str) -> &str {
    match (s.find('{'), s.rfind('}')) {
        (Some(a), Some(b)) if b >= a => &s[a..=b],
        _ => s,
    }
}

/// Status summary shown in the tray.
pub fn services_summary(services: &[Service]) -> String {
    let up = services.iter().filter(|s| s.up == Some(true)).count();
    let down: Vec<&str> = services.iter().filter(|s| s.up == Some(false)).map(|s| s.id.as_str()).collect();
    if down.is_empty() {
        format!("Services: {up} up")
    } else {
        format!("Services: {up} up, down: {}", down.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare_matches_update_check() {
        assert!(is_newer_version("5.4.8", "5.4.9"));
        assert!(is_newer_version("5.4.8", "5.10.0"));
        assert!(!is_newer_version("5.4.9", "5.4.8"));
        assert!(!is_newer_version("5.4.8", "5.4.8"));
        assert!(is_newer_version("5.5.0-beta.1", "5.5.0"));
        assert!(!is_newer_version("5.5.0", "5.5.0-beta.1"));
        assert!(is_newer_version("5.5.0-beta.1", "5.5.0-beta.2"));
        assert!(is_newer_version("5.5.0-alpha", "5.5.0-beta"));
    }

    #[test]
    fn update_available_respects_channels() {
        assert!(is_update_available("5.4.8", "5.4.9"));
        assert!(!is_update_available("5.4.8", "5.4.8"));
        assert!(!is_update_available("5.4.8", "unknown"));
        assert!(!is_update_available("5.4.8", "5.5.0-beta.1"));
        assert!(is_update_available("5.5.0-beta.1", "5.5.0"));
        assert!(is_update_available("5.5.0-beta.1", "5.4.9"));
    }

    #[test]
    fn reads_cache_root_and_versions() {
        assert_eq!(parse_latest_cached(r#"{"@hybridlabor-api/aos":{"v":"5.4.9","t":1}}"#).as_deref(), Some("5.4.9"));
        assert_eq!(parse_latest_cached(r#"{"@hybridlabor-api/aos":{"v":"unknown","t":1}}"#), None);
        assert_eq!(parse_latest_cached("not json"), None);
        assert_eq!(parse_package_root("\u{feff}{\"packageRoot\":\"/x/aos\"}\n"), Some(PathBuf::from("/x/aos")));
        assert_eq!(parse_package_root(r#"{"packageRoot":""}"#), None);
        assert_eq!(parse_version_field(r#"{"version":"5.4.8"}"#).as_deref(), Some("5.4.8"));
    }

    #[test]
    fn settings_parse_is_lenient() {
        let s = parse_v5_settings(r#"{"profile":"standard","disabled":["hub",3],"updates":"notify","extra":1}"#);
        assert_eq!(s, SettingsView { profile: Some("standard".into()), disabled: vec!["hub".into()], updates: Some("notify".into()), valid: true });
        assert!(!parse_v5_settings("{broken").valid);
        assert!(!parse_v5_settings("[]").valid);
    }

    #[test]
    fn hub_port_ignores_token() {
        assert_eq!(parse_hub_port(r#"{"pid":1,"port":7900,"version":"5.4.8","token":"t"}"#), Some(7900));
        assert_eq!(parse_hub_port("{}"), None);
    }

    #[test]
    fn parses_cli_json() {
        let s = parse_services("Warning: x\n{\"services\":[{\"id\":\"hub\",\"name\":\"Hub\",\"up\":true,\"url\":\"http://127.0.0.1:7900\"},{\"id\":\"memb\",\"up\":false},{\"id\":\"x\",\"up\":null}]}").unwrap();
        assert_eq!(s.len(), 3);
        assert_eq!(services_summary(&s), "Services: 1 up, down: memb");
        let g = parse_gateway(r#"{"running":false,"port":7790,"error":"gateway not running","upstreams":[{"name":"github","ok":false,"error":"gateway not running"}]}"#).unwrap();
        assert!(!g.running);
        assert_eq!(g.upstreams[0].name, "github");
        let d = parse_doctor(r#"{"ok":false,"platform":"win32","arch":"x64","results":[{"area":"deps","name":"node","ok":false,"detail":"missing","fix":null,"warningOnly":false}]}"#).unwrap();
        assert!(!d.ok);
        assert_eq!(d.results[0].name, "node");
        assert!(parse_services("garbage").is_err());
    }
}
