//! Every AOS CLI call the tray makes. Argv is built from a closed enum: no shell, no string
//! from the webview reaches a command line except a gateway server name, which must be one of
//! the shipped names in lib/gateway/config.js (GATEWAY_SERVERS).
//! Commands and flags: docs/cli-reference.md, lib/cli-specs/core.mjs.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Shipped gateway server names (lib/gateway/config.js GATEWAY_SERVERS, AOS 5.4.8).
pub const GATEWAY_SERVERS: &[&str] = &[
    "github",
    "open_design_mcp",
    "bdb_resolume_mcp",
    "bdb_grandma3_mcp",
    "bdb_blender_mcp",
    "bdb_davinci_mcp",
    "adobe_uxp_mcp",
    "bdb_unreal_mcp",
    "bdb_after_effects_mcp",
    "chrome-devtools",
    "bdb_td_backup",
    "codebase_memory_mcp",
    "zavora_computer_use",
    "bdb_windows_computer_use",
    "bdb_remoteos_mcp",
];

/// Hub tabs accepted by `aos-hub open --tab` (lib/hub/ui/app.js TABS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HubTab {
    Services,
    Store,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// `npx -y @hybridlabor-api/aos@latest --yes` (first install, non-interactive).
    Install,
    /// `npx -y @hybridlabor-api/aos@latest update --yes`: `aos update` alone re-runs the
    /// installed package, so the newer version has to come from npm.
    Update,
    /// `aos repair --yes`
    Repair,
    /// `aos version`
    Version,
    /// `aos services status --json`
    ServicesStatus,
    /// `aos doctor --json`
    Doctor,
    /// `aos store packs`
    StorePacks,
    /// `aos memory list`
    MemoryList,
    /// `aos-gateway status --json`
    GatewayStatus,
    /// `aos-gateway add <server>`
    GatewayAdd(String),
    /// `aos-gateway remove <server>`
    GatewayRemove(String),
    /// `aos-router show --json`
    RouterShow,
    /// `aos-hub open --tab <tab>`
    HubOpen(HubTab),
}

/// Which program runs the argv.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Program {
    /// `node <packageRoot>/<script> ...`
    Script(&'static str),
    /// `npx ...`
    Npx,
}

pub const NPX_PACKAGE: &str = "@hybridlabor-api/aos@latest";

pub fn valid_server(name: &str) -> bool {
    GATEWAY_SERVERS.contains(&name)
}

impl Action {
    pub fn changes_state(&self) -> bool {
        matches!(self, Action::Install | Action::Update | Action::Repair | Action::GatewayAdd(_) | Action::GatewayRemove(_))
    }

    /// Text of the native confirmation dialog, built here and never from webview input.
    pub fn confirm_text(&self) -> Option<String> {
        Some(match self {
            Action::Install => "Install AOS for this user with `npx -y @hybridlabor-api/aos@latest --yes`? This downloads the package from npm and writes skills, hooks and MCP configs into your home directory.".into(),
            Action::Update => "Update AOS to the latest npm release (`npx -y @hybridlabor-api/aos@latest update --yes`)? Installed files are rewritten; the installer keeps backups.".into(),
            Action::Repair => "Repair the installed AOS (`aos repair --yes`)? Installed files that drifted are rewritten.".into(),
            Action::GatewayAdd(s) => format!("Add `{s}` to the MCP gateway selection? The gateway service restarts."),
            Action::GatewayRemove(s) => format!("Remove `{s}` from the MCP gateway selection? The gateway service restarts; it disappears from harnesses on the next update."),
            _ => return None,
        })
    }

    /// Timeout: installs can take many minutes, probes must not hang the tray.
    pub fn timeout(&self) -> Duration {
        match self {
            Action::Install | Action::Update | Action::Repair => Duration::from_secs(30 * 60),
            Action::GatewayAdd(_) | Action::GatewayRemove(_) => Duration::from_secs(5 * 60),
            Action::Doctor => Duration::from_secs(3 * 60),
            _ => Duration::from_secs(60),
        }
    }

    pub fn program(&self) -> Program {
        match self {
            Action::Install | Action::Update => Program::Npx,
            Action::Repair | Action::Version | Action::ServicesStatus | Action::Doctor | Action::StorePacks | Action::MemoryList => Program::Script("installer.js"),
            Action::GatewayStatus | Action::GatewayAdd(_) | Action::GatewayRemove(_) => Program::Script("bin/aos-gateway.mjs"),
            Action::RouterShow => Program::Script("bin/aos-router.mjs"),
            Action::HubOpen(_) => Program::Script("bin/aos-hub.mjs"),
        }
    }

    /// Arguments after the program (after `node <script>` or `npx`).
    pub fn argv(&self) -> Result<Vec<String>, String> {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        Ok(match self {
            Action::Install => v(&["-y", NPX_PACKAGE, "--yes"]),
            Action::Update => v(&["-y", NPX_PACKAGE, "update", "--yes"]),
            Action::Repair => v(&["repair", "--yes"]),
            Action::Version => v(&["version"]),
            Action::ServicesStatus => v(&["services", "status", "--json"]),
            Action::Doctor => v(&["doctor", "--json"]),
            Action::StorePacks => v(&["store", "packs"]),
            Action::MemoryList => v(&["memory", "list"]),
            Action::GatewayStatus => v(&["status", "--json"]),
            Action::GatewayAdd(s) | Action::GatewayRemove(s) => {
                if !valid_server(s) {
                    return Err("unknown gateway server".into());
                }
                let cmd = if matches!(self, Action::GatewayAdd(_)) { "add" } else { "remove" };
                vec![cmd.to_string(), s.clone()]
            }
            Action::RouterShow => v(&["show", "--json"]),
            Action::HubOpen(HubTab::Services) => v(&["open", "--tab", "services"]),
            Action::HubOpen(HubTab::Store) => v(&["open", "--tab", "store"]),
        })
    }
}

/// Directories searched for node/npx besides PATH: a GUI app on macOS does not inherit the
/// login shell PATH. Version managers (nvm, fnm, volta) are not covered.
#[cfg(target_os = "macos")]
const EXTRA_BIN_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin"];
#[cfg(not(target_os = "macos"))]
const EXTRA_BIN_DIRS: &[&str] = &[];

pub fn exe_names(base: &str) -> Vec<String> {
    if cfg!(windows) {
        if base == "node" {
            vec!["node.exe".into()]
        } else {
            vec![format!("{base}.cmd"), format!("{base}.exe")]
        }
    } else {
        vec![base.into()]
    }
}

/// Finds an executable in the given directories (first match wins). Pure apart from `is_file`.
pub fn find_in(dirs: &[PathBuf], base: &str) -> Option<PathBuf> {
    for d in dirs {
        for n in exe_names(base) {
            let p = d.join(&n);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).filter(|d| d.is_absolute()).collect()).unwrap_or_default();
    dirs.extend(EXTRA_BIN_DIRS.iter().map(PathBuf::from));
    dirs
}

/// The recorded package root is only trusted when its package.json names the AOS package.
pub fn verified_package_root(home: &Path) -> Option<PathBuf> {
    let rec = std::fs::read_to_string(crate::state::package_root_record(home)).ok()?;
    let root = crate::state::parse_package_root(&rec)?;
    let pkg = std::fs::read_to_string(root.join("package.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&pkg).ok()?;
    if v.get("name")?.as_str()? != "@hybridlabor-api/aos" || !root.join("installer.js").is_file() {
        return None;
    }
    Some(root)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

impl Output {
    pub fn ok(&self) -> bool {
        self.code == Some(0) && !self.timed_out
    }
}

/// Resolves program + full argv for an action. Errors name what is missing.
pub fn resolve(action: &Action, home: &Path) -> Result<(PathBuf, Vec<String>), String> {
    let dirs = search_dirs();
    let mut args = action.argv()?;
    match action.program() {
        Program::Npx => {
            // npx next to the node we would use, else PATH.
            let node = find_in(&dirs, "node").ok_or("Node.js not found (install Node.js 20+ first)")?;
            let mut d = vec![node.parent().map(Path::to_path_buf).unwrap_or_default()];
            d.extend(dirs);
            let npx = find_in(&d, "npx").ok_or("npx not found next to Node.js")?;
            Ok((npx, args))
        }
        Program::Script(script) => {
            let root = verified_package_root(home).ok_or("AOS is not installed (no verified package root); use Install")?;
            let node = find_in(&dirs, "node").ok_or("Node.js not found")?;
            let mut full = vec![root.join(script).to_string_lossy().into_owned()];
            full.append(&mut args);
            Ok((node, full))
        }
    }
}

/// Runs a resolved command: stdin null, no window on Windows, output captured, killed on timeout.
pub fn run_program(program: &Path, args: &[String], home: &Path, timeout: Duration) -> Result<Output, String> {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(home).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("cannot start {} ({})", program.display(), e.kind()))?;
    let mut so = child.stdout.take().ok_or("no stdout")?;
    let mut se = child.stderr.take().ok_or("no stderr")?;
    let t_out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = so.read_to_string(&mut s);
        s
    });
    let t_err = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = se.read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if start.elapsed() >= timeout => {
                timed_out = true;
                let _ = child.kill();
                break child.wait().ok();
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => return Err(format!("wait failed ({})", e.kind())),
        }
    };
    Ok(Output {
        code: status.and_then(|s| s.code()),
        stdout: t_out.join().unwrap_or_default(),
        stderr: t_err.join().unwrap_or_default(),
        timed_out,
    })
}

pub fn run(action: &Action, home: &Path) -> Result<Output, String> {
    let (program, args) = resolve(action, home)?;
    run_program(&program, &args, home, action.timeout())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_is_fixed_per_action() {
        assert_eq!(Action::ServicesStatus.argv().unwrap(), ["services", "status", "--json"]);
        assert_eq!(Action::Doctor.argv().unwrap(), ["doctor", "--json"]);
        assert_eq!(Action::Repair.argv().unwrap(), ["repair", "--yes"]);
        assert_eq!(Action::Install.argv().unwrap(), ["-y", "@hybridlabor-api/aos@latest", "--yes"]);
        assert_eq!(Action::Update.argv().unwrap(), ["-y", "@hybridlabor-api/aos@latest", "update", "--yes"]);
        assert_eq!(Action::GatewayStatus.argv().unwrap(), ["status", "--json"]);
        assert_eq!(Action::RouterShow.argv().unwrap(), ["show", "--json"]);
        assert_eq!(Action::HubOpen(HubTab::Store).argv().unwrap(), ["open", "--tab", "store"]);
        assert_eq!(Action::GatewayAdd("chrome-devtools".into()).argv().unwrap(), ["add", "chrome-devtools"]);
        assert_eq!(Action::GatewayRemove("github".into()).argv().unwrap(), ["remove", "github"]);
    }

    #[test]
    fn gateway_names_are_allowlisted() {
        for bad in ["", "-x", "--dry-run", "github; rm", "GITHUB", "a b", "../x", "github\n"] {
            assert!(Action::GatewayAdd(bad.into()).argv().is_err(), "{bad:?}");
            assert!(Action::GatewayRemove(bad.into()).argv().is_err(), "{bad:?}");
        }
    }

    #[test]
    fn programs_and_confirmations() {
        assert_eq!(Action::Update.program(), Program::Npx);
        assert_eq!(Action::Doctor.program(), Program::Script("installer.js"));
        assert_eq!(Action::GatewayAdd("github".into()).program(), Program::Script("bin/aos-gateway.mjs"));
        for a in [Action::Install, Action::Update, Action::Repair, Action::GatewayAdd("github".into()), Action::GatewayRemove("github".into())] {
            assert!(a.changes_state());
            assert!(a.confirm_text().is_some());
        }
        for a in [Action::Doctor, Action::ServicesStatus, Action::Version, Action::GatewayStatus, Action::RouterShow] {
            assert!(!a.changes_state());
            assert!(a.confirm_text().is_none());
        }
    }

    #[test]
    fn package_root_must_be_aos() {
        let home = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let rec = crate::state::package_root_record(home.path());
        std::fs::create_dir_all(rec.parent().unwrap()).unwrap();
        std::fs::write(&rec, serde_json::json!({ "packageRoot": root.path() }).to_string()).unwrap();
        std::fs::write(root.path().join("package.json"), r#"{"name":"evil"}"#).unwrap();
        std::fs::write(root.path().join("installer.js"), "").unwrap();
        assert!(verified_package_root(home.path()).is_none());
        std::fs::write(root.path().join("package.json"), r#"{"name":"@hybridlabor-api/aos"}"#).unwrap();
        assert_eq!(verified_package_root(home.path()).as_deref(), Some(root.path()));
    }

    #[test]
    fn find_in_uses_platform_names() {
        let d = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) { "npx.cmd" } else { "npx" };
        std::fs::write(d.path().join(name), "").unwrap();
        assert_eq!(find_in(&[d.path().to_path_buf()], "npx"), Some(d.path().join(name)));
        assert_eq!(find_in(&[d.path().to_path_buf()], "node"), None);
    }
}
