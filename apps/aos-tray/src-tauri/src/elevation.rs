//! Refuse state-changing actions when the tray runs elevated. Mirrors lib/executable-probe.js
//! (Windows: `net session` succeeds only for an administrator; Unix: uid 0), but calls the
//! tools by absolute path so a PATH entry cannot replace them.

use std::process::{Command, Stdio};

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use std::os::windows::process::CommandExt;
    let root = std::env::var_os("SystemRoot").map(std::path::PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| "C:\\Windows".into());
    Command::new(root.join("System32").join("net.exe"))
        .arg("session")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(0x0800_0000)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(unix)]
pub fn is_elevated() -> bool {
    Command::new("/usr/bin/id")
        .arg("-u")
        .stdin(Stdio::null())
        .output()
        .map(|o| parse_uid_is_root(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or(false)
}

pub fn parse_uid_is_root(out: &str) -> bool {
    out.trim() == "0"
}

#[cfg(test)]
mod tests {
    #[test]
    fn uid_parse() {
        assert!(super::parse_uid_is_root("0\n"));
        assert!(!super::parse_uid_is_root("501\n"));
        assert!(!super::parse_uid_is_root(""));
    }
}
