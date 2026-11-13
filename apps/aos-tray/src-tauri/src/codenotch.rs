//! Codenotch (the usage notch app) from the AOS point of view: is it installed, is it running,
//! start it. Install and update go through the AOS CLI (`Action::CodenotchInstall`), which
//! verifies the release checksum; this module never downloads or runs an installer itself.
//! Codenotch's Windows build exposes no usage numbers, so only install state is shown.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
pub struct Info {
    pub supported: bool,
    pub installed: bool,
    pub running: bool,
    /// Where the app was found (shown as a hint, never used to run anything else).
    pub path: Option<String>,
}

/// Candidate install locations, most likely first.
pub fn candidates(local_data: Option<&Path>, home: &Path) -> Vec<PathBuf> {
    if cfg!(windows) {
        local_data.map(|d| vec![d.join("Codenotch").join("codenotch.exe")]).unwrap_or_default()
    } else {
        vec![PathBuf::from("/Applications/Codenotch.app"), home.join("Applications").join("Codenotch.app")]
    }
}

pub fn find_installed(local_data: Option<&Path>, home: &Path) -> Option<PathBuf> {
    candidates(local_data, home).into_iter().find(|p| p.exists())
}

/// `tasklist /FI "IMAGENAME eq codenotch.exe" /NH` prints one line per match, or an info line.
pub fn tasklist_has(output: &str) -> bool {
    output.lines().any(|l| l.trim_start().to_ascii_lowercase().starts_with("codenotch.exe"))
}

fn is_running() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        return Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq codenotch.exe", "/NH"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000)
            .output()
            .map(|o| tasklist_has(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or(false);
    }
    #[cfg(target_os = "macos")]
    {
        return Command::new("/usr/bin/pgrep").args(["-x", "Codenotch"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
    }
    #[allow(unreachable_code)]
    false
}

pub fn detect(home: &Path) -> Info {
    let supported = cfg!(any(windows, target_os = "macos"));
    if !supported {
        return Info::default();
    }
    let found = find_installed(dirs::data_local_dir().as_deref(), home);
    Info { supported, installed: found.is_some(), running: found.is_some() && is_running(), path: found.map(|p| p.display().to_string()) }
}

/// Starts the installed app detached. Refuses when it is not installed.
pub fn start(home: &Path) -> Result<(), String> {
    let path = find_installed(dirs::data_local_dir().as_deref(), home).ok_or_else(|| "Codenotch is not installed".to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | DETACHED_PROCESS: the app keeps running when the tray quits.
        Command::new(&path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x0800_0000 | 0x0000_0008).spawn().map(|_| ()).map_err(|e| format!("could not start Codenotch: {e}"))
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open").arg(&path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map(|_| ()).map_err(|e| format!("could not start Codenotch: {e}"))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = path;
        Err("Codenotch is available on Windows and macOS only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tasklist_match_is_per_line_and_case_insensitive() {
        assert!(tasklist_has("codenotch.exe                12345 Console    1    45,000 K\r\n"));
        assert!(tasklist_has("Codenotch.EXE 1 Console"));
        assert!(!tasklist_has("INFO: No tasks are running which match the specified criteria."));
        assert!(!tasklist_has("other-codenotch.exe 1"));
        assert!(!tasklist_has(""));
    }

    #[test]
    fn candidates_depend_on_platform() {
        let home = Path::new("/h");
        let c = candidates(Some(Path::new("/l")), home);
        if cfg!(windows) {
            assert_eq!(c.len(), 1);
            assert!(c[0].ends_with("codenotch.exe"));
            assert!(candidates(None, home).is_empty());
        } else {
            assert!(c.iter().all(|p| p.to_string_lossy().ends_with("Codenotch.app")));
        }
    }

    #[test]
    fn find_installed_needs_an_existing_path() {
        let d = tempfile::tempdir().unwrap();
        assert!(find_installed(Some(d.path()), d.path()).is_none());
        if cfg!(windows) {
            let dir = d.path().join("Codenotch");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("codenotch.exe"), b"x").unwrap();
            assert!(find_installed(Some(d.path()), d.path()).is_some());
        }
    }
}
