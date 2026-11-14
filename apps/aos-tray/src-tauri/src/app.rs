//! AOS tray: Tauri glue (feature `app`). Pure logic lives in cli, state, secrets, agents_md;
//! this file wires it to the tray menu, the main app window ("main"), the hub window ("hub",
//! no IPC) and native dialogs.

use crate::{agents_md, awake, cli, codenotch, elevation, hub, projects, secrets, state};
use crate::cli::{Action, HubTab};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// One state-changing action at a time; background refresh skips while one runs.
static BUSY: Mutex<()> = Mutex::new(());

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "home directory not found".to_string())
}

/// Native OK/Cancel dialog. Must not run on the main thread (blocking_show).
fn confirm(app: &AppHandle, text: &str) -> bool {
    app.dialog().message(text).title("AOS").kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::OkCancel).blocking_show()
}

fn info(app: &AppHandle, text: &str) {
    app.dialog().message(text).title("AOS").kind(MessageDialogKind::Info).blocking_show();
}

/// Elevation check + native confirmation + single-flight, then `f`.
fn guarded<T>(app: &AppHandle, text: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    if elevation::is_elevated() {
        return Err("AOS tray refuses changes while running as administrator/root; start it as your normal user".into());
    }
    let _lock = BUSY.try_lock().map_err(|_| "another AOS action is still running".to_string())?;
    if !confirm(app, text) {
        return Err("cancelled".into());
    }
    f()
}

fn run_action(app: &AppHandle, action: Action) -> Result<cli::Output, String> {
    let home = home()?;
    match action.confirm_text() {
        Some(text) => guarded(app, &text, || cli::run(&action, &home)),
        None => cli::run(&action, &home),
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("task failed: {e}"))?
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Status {
    pub installed: bool,
    pub version: Option<String>,
    pub latest: Option<String>,
    pub update_available: bool,
    pub services: Vec<state::Service>,
    pub services_error: Option<String>,
    pub settings: state::SettingsView,
    pub elevated: bool,
}

fn read(p: PathBuf) -> Option<String> {
    std::fs::read_to_string(p).ok()
}

fn compute_status() -> Result<Status, String> {
    let home = home()?;
    let root = cli::verified_package_root(&home);
    let version = root
        .as_ref()
        .and_then(|r| read(r.join("package.json")))
        .and_then(|t| state::parse_version_field(&t))
        .or_else(|| read(state::manifest(&home)).and_then(|t| state::parse_version_field(&t)));
    let latest = read(state::versions_cache(&home)).and_then(|t| state::parse_latest_cached(&t));
    let update_available = matches!((&version, &latest), (Some(v), Some(l)) if state::is_update_available(v, l));
    let (services, services_error) = if root.is_some() {
        match cli::run(&Action::ServicesStatus, &home) {
            Ok(o) => match state::parse_services(&o.stdout) {
                Ok(s) => (s, None),
                Err(e) => (vec![], Some(e)),
            },
            Err(e) => (vec![], Some(e)),
        }
    } else {
        (vec![], None)
    };
    Ok(Status {
        installed: root.is_some(),
        version,
        latest,
        update_available,
        services,
        services_error,
        settings: read(state::v5_settings(&home)).map(|t| state::parse_v5_settings(&t)).unwrap_or_default(),
        elevated: elevation::is_elevated(),
    })
}

// ------------------------------------------------------------------ commands (settings window)

#[tauri::command]
async fn get_status() -> Result<Status, String> {
    blocking(compute_status).await
}

#[tauri::command]
async fn run_doctor() -> Result<state::Doctor, String> {
    blocking(|| {
        let o = cli::run(&Action::Doctor, &home()?)?;
        // doctor exits non-zero when a check fails; the JSON is still the answer.
        state::parse_doctor(&o.stdout)
    })
    .await
}

#[tauri::command]
async fn lifecycle(app: AppHandle, kind: String) -> Result<String, String> {
    let action = match kind.as_str() {
        "install" => Action::Install,
        "update" => Action::Update,
        "repair" => Action::Repair,
        _ => return Err("unknown action".into()),
    };
    blocking(move || {
        let o = run_action(&app, action)?;
        if o.timed_out {
            return Err("timed out".into());
        }
        Ok(tail(&format!("{}{}", o.stdout, o.stderr), 4000))
    })
    .await
}

#[tauri::command]
async fn open_hub(tab: String) -> Result<(), String> {
    let tab = match tab.as_str() {
        "store" => HubTab::Store,
        _ => HubTab::Services,
    };
    blocking(move || cli::run(&Action::HubOpen(tab), &home()?).map(|_| ())).await
}

#[tauri::command]
async fn list_skills() -> Result<Vec<String>, String> {
    blocking(|| {
        let dir = state::skills_dir(&home()?);
        let mut out: Vec<String> = std::fs::read_dir(&dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.path().join("SKILL.md").is_file())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        out.sort();
        Ok(out)
    })
    .await
}

fn text_of(action: Action) -> Result<String, String> {
    let o = cli::run(&action, &home()?)?;
    Ok(tail(&format!("{}{}", o.stdout, o.stderr), 20000))
}

#[tauri::command]
async fn store_packs() -> Result<String, String> {
    blocking(|| text_of(Action::StorePacks)).await
}

#[tauri::command]
async fn router_show() -> Result<String, String> {
    blocking(|| text_of(Action::RouterShow)).await
}

/// Router screen: the table as typed data, raw text when the JSON does not parse.
#[tauri::command]
async fn router_view() -> Result<state::Parsed<crate::router::RouterView>, String> {
    blocking(|| {
        let o = cli::run(&Action::RouterShow, &home()?)?;
        Ok(state::parsed_or_raw(&o.stdout, &o.stderr, crate::router::parse_show))
    })
    .await
}

/// Router screen: set the preference list of one role (user layer only).
#[tauri::command]
async fn router_set(app: AppHandle, role: String, targets: Vec<String>) -> Result<String, String> {
    if !crate::router::valid_role(&role) {
        return Err("unknown router role".into());
    }
    crate::router::validate_targets(&targets)?;
    blocking(move || {
        let o = run_action(&app, Action::RouterSet(role, targets))?;
        let text = tail(&format!("{}{}", o.stdout, o.stderr), 2000);
        if o.ok() { Ok(text) } else { Err(text) }
    })
    .await
}

// ------------------------------------------------------------------ always on (keep awake)

/// The holder thread, the current mode and the tray menu item that shows it.
struct AwakeState {
    holder: awake::Holder,
    mode: Mutex<awake::Mode>,
    item: MenuItem<Wry>,
}

#[derive(Serialize)]
struct AwakeView {
    supported: bool,
    mode: awake::Mode,
    now: i64,
}

fn awake_label(mode: awake::Mode) -> &'static str {
    match mode {
        awake::Mode::Off => "Always on: off (click to turn on)",
        awake::Mode::On => "Always on: on (click to turn off)",
        awake::Mode::Until(_) => "Always on: timer running (click to turn off)",
    }
}

fn awake_file() -> Result<PathBuf, String> {
    Ok(home()?.join(".aos").join("tray-awake.json"))
}

/// Applies a mode: starts or releases the hold, updates the tray text, saves it for the next start.
fn apply_awake(app: &AppHandle, mode: awake::Mode) -> Result<AwakeView, String> {
    let st = app.state::<AwakeState>();
    let mode = awake::normalize(mode, awake::now_unix());
    st.holder.set(mode);
    *st.mode.lock().map_err(|_| "state lock failed".to_string())? = mode;
    let _ = st.item.set_text(awake_label(mode));
    if let Ok(p) = awake_file() {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, serde_json::to_string(&mode).unwrap_or_default());
    }
    Ok(AwakeView { supported: awake::supported(), mode, now: awake::now_unix() })
}

#[tauri::command]
async fn awake_get(app: AppHandle) -> Result<AwakeView, String> {
    let st = app.state::<AwakeState>();
    let now = awake::now_unix();
    let mode = awake::normalize(*st.mode.lock().map_err(|_| "state lock failed".to_string())?, now);
    Ok(AwakeView { supported: awake::supported(), mode, now })
}

/// `kind` is "off", "on" or "timer" (with `minutes`). Harmless, so no native confirmation.
#[tauri::command]
async fn awake_set(app: AppHandle, kind: String, minutes: Option<u32>) -> Result<AwakeView, String> {
    if !awake::supported() {
        return Err("Always on is available on Windows and macOS only".into());
    }
    let mode = match kind.as_str() {
        "off" => awake::Mode::Off,
        "on" => awake::Mode::On,
        "timer" => awake::timer(awake::now_unix(), minutes.ok_or_else(|| "minutes is required".to_string())?)?,
        _ => return Err("unknown mode".into()),
    };
    apply_awake(&app, mode)
}

/// Home card: the go-gate mode word (read-only), or null when it cannot be read.
#[tauri::command]
async fn gogate_mode() -> Result<Option<String>, String> {
    blocking(|| {
        let o = cli::run(&Action::GogateStatus, &home()?)?;
        Ok(crate::overview::parse_gogate_mode(&format!("{}\n{}", o.stdout, o.stderr)))
    })
    .await
}

// ------------------------------------------------------------------ store (hub API from Rust)

/// Hub token, kept in Rust only. A new hub start makes a new token; `post_json` refetches on 401.
static HUB_TOKEN: Mutex<Option<String>> = Mutex::new(None);

fn hub_post(port: u16, path: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    // A poisoned lock only means another request panicked; the cached token is still just a string.
    let mut token = HUB_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
    crate::hubapi::post_json(port, &mut token, path, body)
}

/// One-line outcome of an install/rollback reply: ok, or the error text.
fn hub_reply_text(v: &serde_json::Value) -> Result<String, String> {
    let ok = v.get("ok").and_then(serde_json::Value::as_bool).unwrap_or(false);
    let text = |k: &str| v.get(k).and_then(serde_json::Value::as_str).unwrap_or("").to_string();
    let out = tail(&format!("{}{}", text("stdout"), text("stderr")), 2000);
    if ok { Ok(if out.trim().is_empty() { "Done.".into() } else { out }) } else { Err(if out.trim().is_empty() { "The hub reported a failure.".into() } else { out }) }
}

/// Read from the hub. The port comes from hub.json; the hub is only started when nothing answers
/// there, so merely opening a screen does not spawn a process while the hub already runs.
fn hub_get(path: &str) -> Result<serde_json::Value, String> {
    let port = read(state::hub_json(&home()?)).and_then(|t| state::parse_hub_port(&t)).unwrap_or(hub::DEFAULT_PORT);
    match crate::hubapi::get_json(port, path) {
        Err(e) if e.starts_with("hub not reachable") => crate::hubapi::get_json(hub_port_started()?, path),
        other => other,
    }
}

/// Library screen: the hub's catalog (skills and agents) plus package states.
#[tauri::command]
async fn store_catalog() -> Result<crate::hubapi::StoreCatalog, String> {
    blocking(|| Ok(crate::hubapi::parse_catalog(&hub_get("/api/store?scope=global")?))).await
}

/// Library screen: the rendered SKILL.md / agent text of one installed item.
#[tauri::command]
async fn store_doc(kind: String, name: String) -> Result<serde_json::Value, String> {
    if !crate::hubapi::valid_kind(&kind) || !crate::hubapi::valid_name(&name) {
        return Err("invalid store item".into());
    }
    blocking(move || hub_get(&format!("/api/store/skill?name={name}&kind={kind}"))).await
}

#[tauri::command]
async fn store_install(app: AppHandle, kind: String, name: String) -> Result<String, String> {
    let body = crate::hubapi::install_body(&kind, &name)?;
    let text = format!("Install the {kind} `{name}` from the AOS store? Files are written into your home directory; the installer checks the source and keeps a rollback.");
    blocking(move || guarded(&app, &text, || {
        let port = hub_port_started()?;
        hub_reply_text(&hub_post(port, "/api/store/install", &body)?)
    }))
    .await
}

#[tauri::command]
async fn store_uninstall(app: AppHandle, name: String) -> Result<String, String> {
    let body = crate::hubapi::rollback_body(&name)?;
    let text = format!("Roll back the store item `{name}`? Its installed files are removed again.");
    blocking(move || guarded(&app, &text, || {
        let port = hub_port_started()?;
        hub_reply_text(&hub_post(port, "/api/store/rollback", &body)?)
    }))
    .await
}

// ------------------------------------------------------------------ codenotch

#[tauri::command]
async fn codenotch_info() -> Result<codenotch::Info, String> {
    blocking(|| Ok(codenotch::detect(&home()?))).await
}

#[tauri::command]
async fn codenotch_start(app: AppHandle) -> Result<(), String> {
    // Launches a program from a user-writable folder: same guard as every other launch
    // (refused when elevated, native confirmation).
    blocking(move || guarded(&app, "Start Codenotch, the usage notch app installed for this user?", || codenotch::start(&home()?))).await
}

/// Install or update through the AOS installer (checksum verified there), after a native confirm.
#[tauri::command]
async fn codenotch_install(app: AppHandle) -> Result<String, String> {
    blocking(move || {
        let o = run_action(&app, Action::CodenotchInstall)?;
        let text = tail(&format!("{}{}", o.stdout, o.stderr), 3000);
        if o.ok() { Ok(text) } else { Err(text) }
    })
    .await
}

#[tauri::command]
async fn memory_list() -> Result<String, String> {
    blocking(|| text_of(Action::MemoryList)).await
}

#[derive(Serialize)]
struct GatewayView {
    status: Option<state::GatewayStatus>,
    error: Option<String>,
    known: Vec<&'static str>,
}

#[tauri::command]
async fn gateway_status() -> Result<GatewayView, String> {
    blocking(|| {
        let known = cli::GATEWAY_SERVERS.to_vec();
        // status --json exits 1 when the gateway is down but still prints JSON.
        Ok(match cli::run(&Action::GatewayStatus, &home()?).and_then(|o| state::parse_gateway(&o.stdout)) {
            Ok(s) => GatewayView { status: Some(s), error: None, known },
            Err(e) => GatewayView { status: None, error: Some(e), known },
        })
    })
    .await
}

#[tauri::command]
async fn gateway_change(app: AppHandle, server: String, add: bool) -> Result<String, String> {
    if !cli::valid_server(&server) {
        return Err("unknown gateway server".into());
    }
    let action = if add { Action::GatewayAdd(server) } else { Action::GatewayRemove(server) };
    blocking(move || {
        let o = run_action(&app, action)?;
        let text = tail(&format!("{}{}", o.stdout, o.stderr), 4000);
        if o.ok() { Ok(text) } else { Err(text) }
    })
    .await
}

#[tauri::command]
async fn agents_md_load() -> Result<agents_md::Loaded, String> {
    blocking(|| agents_md::load(&state::global_agents_md(&home()?))).await
}

#[tauri::command]
async fn agents_md_save(app: AppHandle, text: String, fingerprint: String) -> Result<String, String> {
    blocking(move || {
        let home = home()?;
        guarded(&app, "Save ~/AGENTS.md? The current file is backed up to ~/.aos/backups/aos-tray/ first. Note: AOS updates rewrite the managed blocks in this file.", || {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            let b = agents_md::save(&state::global_agents_md(&home), &home, &text, &fingerprint, now)?;
            Ok(if b.is_some() { "saved (backup written)".into() } else { "saved".into() })
        })
    })
    .await
}

#[tauri::command]
async fn secrets_list() -> Result<Vec<secrets::SecretEntry>, String> {
    blocking(|| Ok(secrets::entries(&secrets::read_text(&secrets::secrets_path(&home()?))?))).await
}

#[tauri::command]
async fn secrets_set(app: AppHandle, name: String, value: String) -> Result<(), String> {
    if !secrets::valid_name(&name) {
        return Err("invalid variable name (A-Z, 0-9, _; not starting with a digit)".into());
    }
    blocking(move || {
        let file = secrets::secrets_path(&home()?);
        // The name is validated above; the value never appears in the dialog or a log.
        guarded(&app, &format!("Set {name} in ~/.aos/secrets.env? Every AOS agent and MCP launcher can read it."), || secrets::set_or_remove(&file, &name, Some(&value)))
    })
    .await
}

#[tauri::command]
async fn secrets_remove(app: AppHandle, name: String) -> Result<(), String> {
    if !secrets::valid_name(&name) {
        return Err("invalid variable name".into());
    }
    blocking(move || {
        let file = secrets::secrets_path(&home()?);
        guarded(&app, &format!("Remove {name} from ~/.aos/secrets.env?"), || secrets::set_or_remove(&file, &name, None))
    })
    .await
}

// ------------------------------------------------------------------ commands (app screens)

/// Home and Services: `aos services status --json`, raw text when the JSON does not parse.
#[tauri::command]
async fn services_view() -> Result<state::Parsed<Vec<state::Service>>, String> {
    blocking(|| {
        let o = cli::run(&Action::ServicesStatus, &home()?)?;
        Ok(state::parsed_or_raw(&o.stdout, &o.stderr, state::parse_services))
    })
    .await
}

/// Home: `aos doctor --json` (non-zero exit when a check fails; the JSON is still the answer).
#[tauri::command]
async fn doctor_view() -> Result<state::Parsed<state::Doctor>, String> {
    blocking(|| {
        let o = cli::run(&Action::Doctor, &home()?)?;
        Ok(state::parsed_or_raw(&o.stdout, &o.stderr, state::parse_doctor))
    })
    .await
}

/// Services: restart one service. The UI asks the user to type the id; Rust checks it again,
/// then shows the native confirmation, and the CLI checks `--confirm <id>` a third time.
#[tauri::command]
async fn service_restart(app: AppHandle, id: String, typed: String) -> Result<String, String> {
    if !cli::valid_service(&id) {
        return Err("unknown service".into());
    }
    if typed.trim() != id {
        return Err("typed name does not match the service id".into());
    }
    blocking(move || {
        let o = run_action(&app, Action::ServiceRestart(id))?;
        let text = tail(&format!("{}{}", o.stdout, o.stderr), 4000);
        if o.ok() { Ok(text) } else { Err(text) }
    })
    .await
}

#[derive(Serialize)]
struct ProjectsView {
    root: Option<String>,
    projects: Vec<projects::Project>,
    error: Option<String>,
}

/// Projects (read-only): child repos of workspaceRoot with meta, wiki and git state.
#[tauri::command]
async fn projects_list() -> Result<ProjectsView, String> {
    blocking(|| {
        let home = home()?;
        let Some(root) = read(projects::aos_config(&home)).and_then(|t| projects::parse_workspace_root(&t, &home)) else {
            return Ok(ProjectsView { root: None, projects: vec![], error: Some("no workspaceRoot in ~/.agents/aos-config.json (aos-config set workspaceRoot <dir>)".into()) });
        };
        let mut list = match projects::scan(&root) {
            Ok(l) => l,
            Err(e) => return Ok(ProjectsView { root: Some(root.to_string_lossy().into_owned()), projects: vec![], error: Some(e) }),
        };
        // One git process per repo, in parallel; each thread writes only its own entry.
        std::thread::scope(|s| {
            for p in list.iter_mut().filter(|p| p.is_git) {
                let dir = root.join(&p.dir);
                s.spawn(move || p.changes = projects::git_changes(&dir));
            }
        });
        Ok(ProjectsView { root: Some(root.to_string_lossy().into_owned()), projects: list, error: None })
    })
    .await
}

/// Store: start the hub without a browser and show it in the "hub" window.
#[tauri::command]
async fn open_store(app: AppHandle) -> Result<(), String> {
    let port = blocking(hub_port_started).await?;
    show_hub(&app, port)
}

fn hub_port_started() -> Result<u16, String> {
    let home = home()?;
    let o = cli::run(&Action::HubStart, &home)?;
    if !o.ok() {
        return Err(tail(&format!("{}{}", o.stdout, o.stderr), 1500));
    }
    Ok(read(state::hub_json(&home)).and_then(|t| state::parse_hub_port(&t)).unwrap_or(hub::DEFAULT_PORT))
}

/// The hub window loads the hub page itself. It is not listed in any capability, so it has no
/// IPC access; navigation is pinned to the hub origin.
fn show_hub(app: &AppHandle, port: u16) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(hub::WINDOW_LABEL) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }
    let url: tauri::Url = hub::hub_url(port).parse().map_err(|_| "invalid hub url".to_string())?;
    tauri::WebviewWindowBuilder::new(app, hub::WINDOW_LABEL, tauri::WebviewUrl::External(url))
        .title("AOS Store")
        .inner_size(1200.0, 820.0)
        .min_inner_size(720.0, 480.0)
        .on_navigation(move |u| hub::navigation_allowed(u.as_str(), port))
        .build()
        .map_err(|e| format!("cannot open the store window: {e}"))?;
    Ok(())
}

fn tail(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    format!("...{}", &s[start..])
}

// ------------------------------------------------------------------ tray

struct TrayItems {
    version: MenuItem<Wry>,
    update: MenuItem<Wry>,
    services: MenuItem<Wry>,
    install: MenuItem<Wry>,
}

fn refresh_tray(app: &AppHandle) {
    // An expired always-on timer: bring the tray label and the saved file back to "off".
    if let Some(st) = app.try_state::<AwakeState>() {
        let cur = st.mode.lock().map(|m| *m).unwrap_or_default();
        let now = awake::normalize(cur, awake::now_unix());
        if now != cur {
            let _ = apply_awake(app, now);
        }
    }
    // Read-only: skip while a change runs, but never hold the lock (a user action must not
    // be refused because a refresh happens to be in flight).
    if BUSY.try_lock().is_err() {
        return;
    }
    let st = compute_status();
    let items = app.state::<TrayItems>();
    match st {
        Ok(s) => {
            let _ = items.version.set_text(match &s.version {
                Some(v) => format!("AOS {v}"),
                None => "AOS not installed".into(),
            });
            let _ = items.update.set_text(match (&s.latest, s.update_available) {
                (Some(l), true) => format!("Update available: {l}"),
                (Some(_), false) => "Up to date".to_string(),
                (None, _) => "Update status unknown".to_string(),
            });
            let _ = items.services.set_text(match &s.services_error {
                Some(_) => "Services: status unavailable".to_string(),
                None if !s.installed => "Services: -".to_string(),
                None => state::services_summary(&s.services),
            });
            let _ = items.install.set_text(if s.installed { "Repair AOS..." } else { "Install AOS..." });
            // Status light: the tooltip carries the one-line state.
            let light = match (&s.services_error, s.installed) {
                (_, false) => "AOS: not installed".to_string(),
                (Some(_), true) => "AOS: services status unavailable".to_string(),
                (None, true) => format!("AOS - {}", state::services_summary(&s.services)),
            };
            if let Some(tray) = app.tray_by_id("aos") {
                let _ = tray.set_tooltip(Some(light));
            }
        }
        Err(_) => {
            let _ = items.version.set_text("AOS status unavailable");
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn tray_action(app: AppHandle, id: String) {
    // Menu events arrive on the main thread; dialogs and CLI calls must not block it.
    std::thread::spawn(move || {
        let result: Result<Option<String>, String> = (|| match id.as_str() {
            "install" => {
                let installed = cli::verified_package_root(&home()?).is_some();
                let o = run_action(&app, if installed { Action::Repair } else { Action::Install })?;
                Ok(Some(if o.ok() { "Done.".into() } else { format!("Failed:\n{}", tail(&o.stderr, 1500)) }))
            }
            "update" => {
                let o = run_action(&app, Action::Update)?;
                Ok(Some(if o.ok() { "AOS updated.".into() } else { format!("Update failed:\n{}", tail(&o.stderr, 1500)) }))
            }
            "doctor" => {
                let o = cli::run(&Action::Doctor, &home()?)?;
                let d = state::parse_doctor(&o.stdout)?;
                let bad: Vec<String> = d.results.iter().filter(|r| !r.ok && !r.warning_only).take(10).map(|r| format!("- {} / {}", r.area, r.name)).collect();
                Ok(Some(if d.ok { format!("Doctor: all {} checks ok.", d.results.len()) } else { format!("Doctor found problems:\n{}\n\nSee Settings > Doctor for details and fixes.", bad.join("\n")) }))
            }
            "store" => {
                let port = hub_port_started()?;
                show_hub(&app, port)?;
                Ok(None)
            }
            _ => Ok(None),
        })();
        match result {
            Ok(Some(msg)) => info(&app, &msg),
            Ok(None) => {}
            Err(e) if e == "cancelled" => {}
            Err(e) => info(&app, &format!("Error: {e}")),
        }
        refresh_tray(&app);
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_status,
            run_doctor,
            lifecycle,
            open_hub,
            list_skills,
            store_packs,
            router_show,
            router_view,
            router_set,
            memory_list,
            gateway_status,
            gateway_change,
            agents_md_load,
            agents_md_save,
            secrets_list,
            secrets_set,
            secrets_remove,
            services_view,
            doctor_view,
            service_restart,
            projects_list,
            open_store,
            gogate_mode,
            store_catalog,
            store_doc,
            store_install,
            store_uninstall,
            awake_get,
            awake_set,
            codenotch_info,
            codenotch_start,
            codenotch_install
        ])
        .on_window_event(|window, event| {
            // Closing the main window hides it (the tray stays); the hub window really closes.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            // A full app window now: keep the default (Regular) activation policy on macOS.
            let version = MenuItem::with_id(app, "version", "AOS: checking...", false, None::<&str>)?;
            let update_status = MenuItem::with_id(app, "update_status", "Update status unknown", false, None::<&str>)?;
            let services = MenuItem::with_id(app, "services", "Services: checking...", false, None::<&str>)?;
            let install = MenuItem::with_id(app, "install", "Install / Repair AOS...", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "Update AOS...", true, None::<&str>)?;
            let doctor = MenuItem::with_id(app, "doctor", "Run doctor", true, None::<&str>)?;
            let hub = MenuItem::with_id(app, "store", "Open Store", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "open", "Open AOS...", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit AOS App (services keep running)", true, None::<&str>)?;
            let awake_item = MenuItem::with_id(app, "awake", awake_label(awake::Mode::Off), awake::supported(), None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&version, &update_status, &services, &sep1, &install, &update, &doctor, &sep2, &hub, &settings, &awake_item, &sep3, &quit])?;

            let mut tray = TrayIconBuilder::with_id("aos").tooltip("AOS").menu(&menu).on_menu_event(|app, event| {
                let id = event.id().as_ref().to_string();
                match id.as_str() {
                    "open" => show_main(app),
                    "awake" => {
                        let cur = awake::normalize(app.state::<AwakeState>().mode.lock().map(|m| *m).unwrap_or_default(), awake::now_unix());
                        let on = !matches!(cur, awake::Mode::Off);
                        let _ = apply_awake(app, if on { awake::Mode::Off } else { awake::Mode::On });
                    }
                    "quit" => app.exit(0),
                    _ => tray_action(app.clone(), id),
                }
            });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            app.manage(TrayItems { version, update: update_status, services, install });

            // Always on: restore the saved mode (an expired timer falls back to off).
            app.manage(AwakeState { holder: awake::Holder::start(), mode: Mutex::new(awake::Mode::Off), item: awake_item });
            if awake::supported() {
                let saved = awake_file().ok().and_then(|p| std::fs::read_to_string(p).ok()).map(|t| awake::parse_saved(&t)).unwrap_or_default();
                let _ = apply_awake(app.handle(), saved);
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                refresh_tray(&handle);
                std::thread::sleep(Duration::from_secs(60));
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the AOS tray")
        .run(|app, event| {
            // Release the keep-awake hold (and the macOS helper) before the process ends.
            if let tauri::RunEvent::Exit = event {
                if let Some(st) = app.try_state::<AwakeState>() {
                    st.holder.stop();
                }
            }
            // Closing the last window must not quit the app: the tray stays.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    fn tail_keeps_char_boundaries() {
        assert_eq!(super::tail("abc", 10), "abc");
        let t = super::tail("ääää", 3);
        assert!(t.starts_with("..."));
    }
}
