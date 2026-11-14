//! Router editor: validation and parsing for `aos-router`. The CLI runs with the home folder
//! as working directory, so its "project" layer would be the same file as the "user" layer;
//! the tray therefore only ever writes the user layer (`--user`).
//! Role and target names mirror KNOWN_ROLES / KNOWN_TARGETS in lib/router/table.js.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const KNOWN_ROLES: &[&str] = &["architect", "techlead", "reviewer", "builder", "scout", "advisor"];
pub const KNOWN_TARGETS: &[&str] = &["claude", "opencode-go", "agy", "codex", "claude-glm"];

pub fn valid_role(role: &str) -> bool {
    KNOWN_ROLES.contains(&role)
}

/// A non-empty, duplicate-free list of known targets. Order is the preference order.
pub fn validate_targets(targets: &[String]) -> Result<(), String> {
    if targets.is_empty() {
        return Err("at least one target is required".into());
    }
    for (i, t) in targets.iter().enumerate() {
        if !KNOWN_TARGETS.contains(&t.as_str()) {
            return Err(format!("unknown target `{t}`"));
        }
        if targets[..i].contains(t) {
            return Err(format!("target `{t}` is listed twice"));
        }
    }
    Ok(())
}

/// The single argv token `a,b,c` of `aos-router set <role> <targets>`.
pub fn targets_arg(targets: &[String]) -> Result<String, String> {
    validate_targets(targets)?;
    Ok(targets.join(","))
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct TargetInfo {
    pub name: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct RouterView {
    pub enforce: bool,
    pub roles: Vec<String>,
    pub targets: Vec<TargetInfo>,
    pub preferences: BTreeMap<String, Vec<String>>,
    /// role -> "shipped" | "user" | "project"
    pub sources: BTreeMap<String, String>,
    /// Allowed values, so the UI never hard-codes them.
    pub known_targets: Vec<String>,
}

#[derive(Deserialize)]
struct Show {
    table: Value,
    #[serde(default)]
    sources: BTreeMap<String, String>,
}

/// `aos-router show --json`.
pub fn parse_show(stdout: &str) -> Result<RouterView, String> {
    let show: Show = serde_json::from_str(crate::state::json_slice(stdout)).map_err(|e| format!("unexpected router output: {e}"))?;
    let t = &show.table;
    let strs = |v: Option<&Value>| -> Vec<String> { v.and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default() };
    let roles = strs(t.get("roles"));
    let mut targets: Vec<TargetInfo> = t
        .get("targets")
        .and_then(Value::as_object)
        .map(|o| o.iter().map(|(k, v)| TargetInfo { name: k.clone(), model: v.get("model").and_then(Value::as_str).map(str::to_string) }).collect())
        .unwrap_or_default();
    targets.sort_by(|a, b| a.name.cmp(&b.name));
    let mut preferences = BTreeMap::new();
    if let Some(p) = t.get("preferences").and_then(Value::as_object) {
        for role in &roles {
            preferences.insert(role.clone(), strs(p.get(role)));
        }
    }
    if roles.is_empty() {
        return Err("router table has no roles".into());
    }
    Ok(RouterView {
        enforce: t.get("enforce").and_then(Value::as_bool).unwrap_or(false),
        roles,
        targets,
        preferences,
        sources: show.sources,
        known_targets: KNOWN_TARGETS.iter().map(|s| s.to_string()).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn roles_and_targets_are_allowlisted() {
        assert!(valid_role("builder"));
        for bad in ["", "Builder", "builder --project", "-h", "../x"] {
            assert!(!valid_role(bad), "{bad:?}");
        }
        assert!(validate_targets(&v(&["claude", "codex"])).is_ok());
        assert!(validate_targets(&[]).is_err());
        assert!(validate_targets(&v(&["claude", "claude"])).is_err());
        assert!(validate_targets(&v(&["claude,codex"])).is_err());
        assert!(validate_targets(&v(&["--user"])).is_err());
        assert!(validate_targets(&v(&[""])).is_err());
    }

    #[test]
    fn targets_arg_is_one_comma_token() {
        assert_eq!(targets_arg(&v(&["opencode-go", "agy"])).unwrap(), "opencode-go,agy");
        assert!(targets_arg(&v(&["nope"])).is_err());
    }

    #[test]
    fn parses_show_output() {
        let out = r#"{"table":{"enforce":true,"roles":["architect","builder"],"targets":{"codex":{"model":null},"claude":{"model":"m1"}},"preferences":{"architect":["claude","codex"],"builder":["codex"]}},"sources":{"architect":"user","builder":"shipped"}}"#;
        let r = parse_show(out).unwrap();
        assert!(r.enforce);
        assert_eq!(r.roles, ["architect", "builder"]);
        assert_eq!(r.targets[0], TargetInfo { name: "claude".into(), model: Some("m1".into()) });
        assert_eq!(r.preferences["architect"], ["claude", "codex"]);
        assert_eq!(r.sources["architect"], "user");
        assert!(parse_show("not json").is_err());
        assert!(parse_show(r#"{"table":{"roles":[]}}"#).is_err());
    }
}
