//! Projects screen (read-only): the child repos of the workspace root named in
//! ~/.agents/aos-config.json (bin/aos-config.mjs). Parsers are pure; `scan` only reads the
//! file system; `git_changes` is the one call that starts a process (`git status --porcelain`).

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn aos_config(home: &Path) -> PathBuf {
    home.join(".agents").join("aos-config.json")
}

fn strip_bom(t: &str) -> &str {
    t.strip_prefix('\u{feff}').unwrap_or(t)
}

/// `workspaceRoot` from aos-config.json; a leading `~` is the home directory (as in aos-config).
pub fn parse_workspace_root(text: &str, home: &Path) -> Option<PathBuf> {
    let v: Value = serde_json::from_str(strip_bom(text)).ok()?;
    let s = v.get("workspaceRoot")?.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    if s == "~" {
        return Some(home.to_path_buf());
    }
    if let Some(rest) = s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")) {
        return Some(home.join(rest));
    }
    let p = PathBuf::from(s);
    if p.is_absolute() {
        Some(p)
    } else {
        None
    }
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct ProjectMeta {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub domain: Option<String>,
}

/// `.aos/project.json` (lib/project-init.js writes `{ name, slug }`; `domain` and a nested
/// `memb.slug` are read when present).
pub fn parse_project_json(text: &str) -> Option<ProjectMeta> {
    let v: Value = serde_json::from_str(strip_bom(text)).ok()?;
    if !v.is_object() {
        return None;
    }
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string).filter(|x| !x.is_empty());
    let slug = s("slug").or_else(|| v.get("memb").and_then(|m| m.get("slug")).and_then(Value::as_str).map(str::to_string));
    Some(ProjectMeta { name: s("name"), slug, domain: s("domain") })
}

/// Number of changed paths in `git status --porcelain` output.
pub fn count_porcelain(stdout: &str) -> usize {
    stdout.lines().filter(|l| l.len() > 3).count()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Project {
    /// Folder name (never the full path: the UI shows names only).
    pub dir: String,
    pub meta: Option<ProjectMeta>,
    pub is_git: bool,
    pub wiki: bool,
    pub agents_md: bool,
    /// Changed paths; None when not a git repo or git could not run.
    pub changes: Option<usize>,
}

fn is_candidate(dir: &Path) -> bool {
    dir.join(".git").exists() || dir.join(".aos").join("project.json").is_file()
}

/// Child folders of `root` that are git repos or AOS projects, sorted by name. Hidden folders
/// and symlinks are skipped. No process is started here (`changes` stays None).
pub fn scan(root: &Path) -> Result<Vec<Project>, String> {
    let rd = std::fs::read_dir(root).map_err(|e| format!("cannot read workspace root ({})", e.kind()))?;
    let mut out = Vec::new();
    for e in rd.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        if !ft.is_dir() || ft.is_symlink() {
            continue;
        }
        let p = e.path();
        if !is_candidate(&p) {
            continue;
        }
        out.push(Project {
            dir: name,
            meta: std::fs::read_to_string(p.join(".aos").join("project.json")).ok().and_then(|t| parse_project_json(&t)),
            is_git: p.join(".git").exists(),
            wiki: p.join("openwiki").is_dir(),
            agents_md: p.join("AGENTS.md").is_file(),
            changes: None,
        });
    }
    out.sort_by(|a, b| a.dir.to_lowercase().cmp(&b.dir.to_lowercase()));
    Ok(out)
}

/// `git -C <repo> status --porcelain` through the same runner as the AOS CLIs (no shell,
/// no window, killed after the timeout).
pub fn git_changes(repo: &Path) -> Option<usize> {
    let git = crate::cli::find_in(&crate::cli::search_dirs(), "git")?;
    let args = vec!["status".to_string(), "--porcelain".to_string()];
    let o = crate::cli::run_program(&git, &args, repo, Duration::from_secs(15)).ok()?;
    if o.ok() {
        Some(count_porcelain(&o.stdout))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_root_expands_home() {
        let home = Path::new("/h");
        assert_eq!(parse_workspace_root(r#"{"workspaceRoot":"~/work"}"#, home), Some(home.join("work")));
        assert_eq!(parse_workspace_root(r#"{"workspaceRoot":"~"}"#, home), Some(home.to_path_buf()));
        assert_eq!(parse_workspace_root(r#"{"workspaceRoot":null}"#, home), None);
        assert_eq!(parse_workspace_root(r#"{"workspaceRoot":"relative/x"}"#, home), None);
        assert_eq!(parse_workspace_root("broken", home), None);
        let abs = if cfg!(windows) { r#"{"workspaceRoot":"C:\\w"}"# } else { r#"{"workspaceRoot":"/w"}"# };
        assert!(parse_workspace_root(abs, home).is_some());
    }

    #[test]
    fn project_json_fields() {
        let m = parse_project_json("\u{feff}{\"name\":\"X\",\"slug\":\"x\",\"domain\":\"show\"}").unwrap();
        assert_eq!(m, ProjectMeta { name: Some("X".into()), slug: Some("x".into()), domain: Some("show".into()) });
        assert_eq!(parse_project_json(r#"{"memb":{"slug":"y"}}"#).unwrap().slug.as_deref(), Some("y"));
        assert!(parse_project_json("[]").is_none());
    }

    #[test]
    fn porcelain_count() {
        assert_eq!(count_porcelain(""), 0);
        assert_eq!(count_porcelain(" M a.rs\n?? b\n"), 2);
    }

    #[test]
    fn scan_lists_repos_only() {
        let root = tempfile::tempdir().unwrap();
        let r = root.path();
        std::fs::create_dir_all(r.join("b-repo").join(".git")).unwrap();
        std::fs::create_dir_all(r.join("A-proj").join(".aos")).unwrap();
        std::fs::write(r.join("A-proj").join(".aos").join("project.json"), r#"{"slug":"a"}"#).unwrap();
        std::fs::create_dir_all(r.join("A-proj").join("openwiki")).unwrap();
        std::fs::create_dir_all(r.join("plain")).unwrap();
        std::fs::create_dir_all(r.join(".hidden").join(".git")).unwrap();
        std::fs::write(r.join("file.txt"), "").unwrap();
        let p = scan(r).unwrap();
        let names: Vec<&str> = p.iter().map(|x| x.dir.as_str()).collect();
        assert_eq!(names, ["A-proj", "b-repo"]);
        assert!(p[0].wiki && !p[0].is_git);
        assert_eq!(p[0].meta.as_ref().unwrap().slug.as_deref(), Some("a"));
        assert!(p[1].is_git && !p[1].wiki && p[1].meta.is_none());
        assert!(scan(&r.join("missing")).is_err());
    }
}
