//! Editor backend for the user-level ~/AGENTS.md that installer.js creates and keeps its
//! managed blocks in. Saving checks the file did not change since it was loaded, writes a
//! backup under ~/.aos/backups/aos-tray/ (last KEEP kept), then replaces the file atomically.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const KEEP: usize = 10;
pub const MAX_BYTES: usize = 1024 * 1024;
const PREFIX: &str = "AGENTS.md.";
const SUFFIX: &str = ".bak";

pub fn backup_dir(home: &Path) -> PathBuf {
    home.join(".aos").join("backups").join("aos-tray")
}

/// FNV-1a 64: a cheap change detector between load and save, not a security hash.
pub fn fingerprint(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Loaded {
    pub path: String,
    pub exists: bool,
    pub text: String,
    pub fingerprint: String,
}

pub fn load(file: &Path) -> Result<Loaded, String> {
    if let Ok(m) = fs::metadata(file) {
        if m.len() > MAX_BYTES as u64 {
            return Err("AGENTS.md is larger than 1 MiB".into());
        }
    }
    let text = match fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("cannot read AGENTS.md ({})", e.kind())),
    };
    Ok(Loaded { path: "~/AGENTS.md".into(), exists: file.exists(), fingerprint: fingerprint(&text), text })
}

/// Names of backups to delete so that at most `keep` remain (names sort by timestamp).
pub fn prune_list(mut names: Vec<String>, keep: usize) -> Vec<String> {
    names.retain(|n| n.starts_with(PREFIX) && n.ends_with(SUFFIX));
    names.sort();
    let n = names.len().saturating_sub(keep);
    names.into_iter().take(n).collect()
}

pub fn save(file: &Path, home: &Path, text: &str, expected_fingerprint: &str, now_ms: u128) -> Result<Option<PathBuf>, String> {
    if text.len() > MAX_BYTES {
        return Err("AGENTS.md is larger than 1 MiB".into());
    }
    let current = load(file)?;
    if current.fingerprint != expected_fingerprint {
        return Err("~/AGENTS.md changed on disk since it was loaded (maybe an AOS update); reload and re-apply your edit".into());
    }
    let mut backup = None;
    if current.exists {
        let dir = backup_dir(home);
        fs::create_dir_all(&dir).map_err(|e| format!("cannot create backup dir ({})", e.kind()))?;
        let b = dir.join(format!("{PREFIX}{now_ms:020}{SUFFIX}"));
        fs::write(&b, current.text.as_bytes()).map_err(|e| format!("cannot write backup ({})", e.kind()))?;
        let names = fs::read_dir(&dir)
            .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default();
        for n in prune_list(names, KEEP) {
            // Only files in our own backup dir that match our own name pattern.
            let _ = fs::remove_file(dir.join(n));
        }
        backup = Some(b);
    }
    // A symlinked ~/AGENTS.md (dotfile setups) is written through to its real target, so the
    // link survives.
    let target = match fs::symlink_metadata(file) {
        Ok(m) if m.file_type().is_symlink() => fs::canonicalize(file).map_err(|e| format!("cannot resolve AGENTS.md link ({})", e.kind()))?,
        _ => file.to_path_buf(),
    };
    let parent = target.parent().ok_or("no parent dir")?;
    let tmp = parent.join(format!("AGENTS.md.{}.aos-tray.tmp", std::process::id()));
    // create_new: never follow or reuse a pre-existing path.
    let f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| format!("cannot create temp file ({})", e.kind()))?;
    let res = write_and_rename(f, text, &tmp, &target);
    if res.is_err() {
        // Our own temp file, created above with create_new.
        let _ = fs::remove_file(&tmp);
    }
    res.map_err(|e| format!("cannot write AGENTS.md ({})", e.kind()))?;
    Ok(backup)
}

fn write_and_rename(mut f: fs::File, text: &str, tmp: &Path, target: &Path) -> std::io::Result<()> {
    f.write_all(text.as_bytes())?;
    f.sync_all()?;
    drop(f);
    fs::rename(tmp, target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prune_keeps_newest() {
        let names: Vec<String> = (1..=13).map(|i| format!("{PREFIX}{i:020}{SUFFIX}")).chain(["other.txt".to_string()]).collect();
        let del = prune_list(names, 10);
        assert_eq!(del.len(), 3);
        assert!(del[0].contains("00000000000000000001"));
        assert!(!del.iter().any(|n| n == "other.txt"));
    }

    #[test]
    fn save_backs_up_and_detects_conflicts() {
        let home = tempfile::tempdir().unwrap();
        let file = home.path().join("AGENTS.md");
        fs::write(&file, "old").unwrap();
        let l = load(&file).unwrap();
        let b = save(&file, home.path(), "new", &l.fingerprint, 1).unwrap().unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        assert_eq!(fs::read_to_string(b).unwrap(), "old");
        // stale fingerprint is refused and nothing changes
        assert!(save(&file, home.path(), "newer", &l.fingerprint, 2).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn save_writes_through_symlink() {
        let home = tempfile::tempdir().unwrap();
        let real = home.path().join("dotfiles-AGENTS.md");
        fs::write(&real, "old").unwrap();
        let link = home.path().join("AGENTS.md");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let l = load(&link).unwrap();
        save(&link, home.path(), "new", &l.fingerprint, 1).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&real).unwrap(), "new");
    }

    #[test]
    fn save_creates_missing_file_without_backup() {
        let home = tempfile::tempdir().unwrap();
        let file = home.path().join("AGENTS.md");
        let l = load(&file).unwrap();
        assert!(!l.exists);
        assert!(save(&file, home.path(), "# Global Agent Rules\n", &l.fingerprint, 1).unwrap().is_none());
    }
}
