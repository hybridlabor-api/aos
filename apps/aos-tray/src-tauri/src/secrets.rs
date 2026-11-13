//! ~/.aos/secrets.env: one `KEY=value` per line, shared by every agent through the
//! `aos-mcp-env` launcher. The parser mirrors `parseEnvText` in lib/mcp-secrets.js and the
//! writer mirrors its `formatEnvLine` (double-quoted, `\\` and `\"` escaped), so the file
//! stays readable by the CLI. Values never leave this module except to be written back to
//! the same file: callers only ever see variable names.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Same cap as lib/mcp-secrets.js (MAX_BYTES).
pub const MAX_BYTES: u64 = 64 * 1024;

pub fn secrets_path(home: &Path) -> PathBuf {
    home.join(".aos").join("secrets.env")
}

/// A variable name accepted by the launcher (bin/aos-mcp-env.mjs): `[A-Za-z_][A-Za-z0-9_]*`.
pub fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    name.len() <= 128 && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Splits one line into (name, raw value) when it is an assignment, like the JS regex
/// `^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$`.
fn split_assignment(line: &str) -> Option<(&str, &str)> {
    let mut rest = line.trim_start();
    if let Some(after) = rest.strip_prefix("export") {
        if after.starts_with(|c: char| c.is_whitespace()) {
            rest = after.trim_start();
        }
    }
    let end = rest
        .char_indices()
        .find(|(_, c)| !(c.is_ascii_alphanumeric() || *c == '_'))
        .map(|(i, _)| i)
        .unwrap_or(rest.len());
    let name = &rest[..end];
    if !valid_name(name) {
        return None;
    }
    let value = rest[end..].trim_start().strip_prefix('=')?;
    Some((name, value))
}

fn unquote(v: &str) -> String {
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        let inner = &v[1..v.len() - 1];
        // Only a well-formed escaped string is unwrapped (JS: ^"((?:[^"\\]|\\.)*)"$).
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        let mut ok = true;
        while let Some(c) = chars.next() {
            match c {
                '\\' => match chars.next() {
                    Some(n @ ('"' | '\\')) => out.push(n),
                    Some(n) => {
                        out.push('\\');
                        out.push(n);
                    }
                    None => {
                        ok = false;
                        break;
                    }
                },
                '"' => {
                    ok = false;
                    break;
                }
                _ => out.push(c),
            }
        }
        if ok {
            return out;
        }
    }
    if v.len() >= 2 && v.starts_with('\'') && v.ends_with('\'') && !v[1..v.len() - 1].contains('\'') {
        return v[1..v.len() - 1].to_string();
    }
    v.to_string()
}

/// Parses the file text into (name, value) pairs; a later duplicate wins, as in JS.
pub fn parse(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some((k, v)) = split_assignment(raw) {
            let v = unquote(v);
            if let Some(slot) = out.iter_mut().find(|(n, _)| n == k) {
                slot.1 = v;
            } else {
                out.push((k.to_string(), v));
            }
        }
    }
    out
}

pub fn format_line(name: &str, value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    for c in value.chars() {
        if c == '\\' || c == '"' {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    format!("{name}=\"{escaped}\"\n")
}

/// Returns the new file text with `name` set (Some) or removed (None). Every existing
/// line for that name is dropped; other lines, comments included, are kept verbatim.
pub fn apply_change(text: &str, name: &str, value: Option<&str>) -> Result<String, String> {
    if !valid_name(name) {
        return Err("invalid variable name".into());
    }
    if let Some(v) = value {
        if v.contains('\n') || v.contains('\r') {
            return Err(format!("value of {name} contains a line break"));
        }
    }
    let mut out = String::with_capacity(text.len() + 64);
    for line in text.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        if matches!(split_assignment(bare), Some((k, _)) if k == name) {
            continue;
        }
        out.push_str(line);
    }
    if let Some(v) = value {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&format_line(name, v));
    }
    Ok(out)
}

/// What the UI may see: names only, never values.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct SecretEntry {
    pub name: String,
    pub has_value: bool,
}

pub fn entries(text: &str) -> Vec<SecretEntry> {
    parse(text)
        .into_iter()
        .map(|(name, v)| SecretEntry { name, has_value: !v.is_empty() })
        .collect()
}

pub fn read_text(file: &Path) -> Result<String, String> {
    match fs::metadata(file) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(format!("cannot read secrets file ({})", e.kind())),
        Ok(m) => {
            if !m.is_file() {
                return Err("secrets path is not a regular file".into());
            }
            if m.len() > MAX_BYTES {
                return Err(format!("secrets file is larger than {MAX_BYTES} bytes"));
            }
            // Same refusal as readSecretsFile: the CLI ignores a group/other-readable file, so
            // the tray must not silently edit one either.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = m.permissions().mode();
                if mode & 0o077 != 0 {
                    return Err(format!("secrets file mode is {:o}, must be 600 (chmod 600 ~/.aos/secrets.env)", mode & 0o777));
                }
            }
        }
    }
    fs::read_to_string(file).map_err(|e| format!("cannot read secrets file ({})", e.kind()))
}

/// Atomic write: a fresh temp file created with mode 0600 (Unix) next to the target, then
/// renamed over it. The directory is created with mode 0700 (Unix).
pub fn write_text(file: &Path, text: &str) -> Result<(), String> {
    if text.len() as u64 > MAX_BYTES {
        return Err(format!("secrets file would exceed {MAX_BYTES} bytes"));
    }
    let dir = file.parent().ok_or("secrets path has no parent directory")?;
    create_private_dir(dir)?;
    let tmp = dir.join(format!("secrets.env.{}.aos-tray.tmp", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut f = open_private_new(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, file)?;
        set_private_mode(file)
    })();
    if result.is_err() {
        // Only our own temp file, created above in this call.
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| format!("cannot write secrets file ({})", e.kind()))
}

pub fn set_or_remove(file: &Path, name: &str, value: Option<&str>) -> Result<(), String> {
    let current = read_text(file)?;
    let next = apply_change(&current, name, value)?;
    write_text(file, &next)
}

#[cfg(unix)]
fn create_private_dir(dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;
    if dir.is_dir() {
        return Ok(());
    }
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .map_err(|e| format!("cannot create {} ({})", dir.display(), e.kind()))
}

#[cfg(not(unix))]
fn create_private_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("cannot create {} ({})", dir.display(), e.kind()))
}

#[cfg(unix)]
fn open_private_new(p: &Path) -> std::io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(p)
}

#[cfg(not(unix))]
fn open_private_new(p: &Path) -> std::io::Result<fs::File> {
    // Windows: the file inherits the ACL of the user profile directory it lives in.
    fs::OpenOptions::new().write(true).create_new(true).open(p)
}

#[cfg(unix)]
fn set_private_mode(p: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(p, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_private_mode(_p: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_the_cli() {
        let text = "# comment\nexport A=1\nB = \"x\\\"y\\\\z\"\nC='lit \"q\"'\n  D=raw value \r\nbad-name=1\nE=\nA=2\n";
        let p = parse(text);
        assert_eq!(
            p,
            vec![
                ("A".into(), "2".into()),
                ("B".into(), "x\"y\\z".into()),
                ("C".into(), "lit \"q\"".into()),
                ("D".into(), "raw value ".into()),
                ("E".into(), "".into()),
            ]
        );
    }

    #[test]
    fn malformed_double_quotes_are_kept_verbatim() {
        assert_eq!(parse("A=\"a\"b\"\n")[0].1, "\"a\"b\"");
    }

    #[test]
    fn export_prefix_needs_whitespace() {
        assert_eq!(parse("exportX=1\n")[0].0, "exportX");
    }

    #[test]
    fn format_round_trips() {
        for v in ["plain", "with \"quotes\"", "back\\slash", "", "=eq= sign", "ünïcode"] {
            let line = format_line("K", v);
            assert_eq!(parse(&line), vec![("K".to_string(), v.to_string())]);
        }
    }

    #[test]
    fn apply_change_sets_replaces_and_removes() {
        let text = "# keep me\nA=1\nB=2\nexport A=3\n";
        let set = apply_change(text, "A", Some("new")).unwrap();
        assert_eq!(set, "# keep me\nB=2\nA=\"new\"\n");
        let removed = apply_change(&set, "B", None).unwrap();
        assert_eq!(removed, "# keep me\nA=\"new\"\n");
        let appended = apply_change("X=1", "Y", Some("2")).unwrap();
        assert_eq!(appended, "X=1\nY=\"2\"\n");
    }

    #[test]
    fn apply_change_rejects_bad_input() {
        assert!(apply_change("", "1BAD", Some("v")).is_err());
        assert!(apply_change("", "A B", Some("v")).is_err());
        assert!(apply_change("", "A", Some("line\nbreak")).is_err());
        assert!(apply_change("", "A", Some("cr\rhere")).is_err());
    }

    #[test]
    fn entries_expose_names_only() {
        let e = entries("A=secret\nB=\n");
        assert_eq!(e, vec![SecretEntry { name: "A".into(), has_value: true }, SecretEntry { name: "B".into(), has_value: false }]);
        let json = serde_json::to_string(&e).unwrap();
        assert!(!json.contains("secret\""));
    }

    #[test]
    fn write_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let file = secrets_path(dir.path());
        assert_eq!(read_text(&file).unwrap(), "");
        set_or_remove(&file, "TOKEN", Some("abc\"def")).unwrap();
        set_or_remove(&file, "OTHER", Some("x")).unwrap();
        set_or_remove(&file, "TOKEN", None).unwrap();
        let text = read_text(&file).unwrap();
        assert_eq!(parse(&text), vec![("OTHER".to_string(), "x".to_string())]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
            let dmode = fs::metadata(file.parent().unwrap()).unwrap().permissions().mode() & 0o777;
            assert_eq!(dmode, 0o700);
        }
        let leftovers: Vec<_> = fs::read_dir(file.parent().unwrap()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".tmp")).collect();
        assert!(leftovers.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_group_readable_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("secrets.env");
        fs::write(&file, "A=1\n").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read_text(&file).is_err());
        assert!(set_or_remove(&file, "B", Some("2")).is_err());
    }

    #[test]
    fn refuses_oversized_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("secrets.env");
        fs::write(&file, vec![b'#'; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(read_text(&file).is_err());
    }
}
