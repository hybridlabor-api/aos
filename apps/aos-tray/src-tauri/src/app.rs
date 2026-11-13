//! AOS tray: Tauri glue (feature `app`). Pure logic lives in cli, state, secrets, agents_md;
//! this file wires it to the tray menu, the settings window and native dialogs.

use crate::{agents_md, cli, elevation, secrets, state};
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
        }
        Err(_) => {
            let _ = items.version.set_text("AOS status unavailable");
        }
    }
}

fn show_settings(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
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
            "hub" => cli::run(&Action::HubOpen(HubTab::Services), &home()?).map(|_| None),
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
            memory_list,
            gateway_status,
            gateway_change,
            agents_md_load,
            agents_md_save,
            secrets_list,
            secrets_set,
            secrets_remove
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let version = MenuItem::with_id(app, "version", "AOS: checking...", false, None::<&str>)?;
            let update_status = MenuItem::with_id(app, "update_status", "Update status unknown", false, None::<&str>)?;
            let services = MenuItem::with_id(app, "services", "Services: checking...", false, None::<&str>)?;
            let install = MenuItem::with_id(app, "install", "Install / Repair AOS...", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "update", "Update AOS...", true, None::<&str>)?;
            let doctor = MenuItem::with_id(app, "doctor", "Run doctor", true, None::<&str>)?;
            let hub = MenuItem::with_id(app, "hub", "Open Hub", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit AOS Tray", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&version, &update_status, &services, &sep1, &install, &update, &doctor, &sep2, &hub, &settings, &sep3, &quit])?;

            let mut tray = TrayIconBuilder::with_id("aos").tooltip("AOS").menu(&menu).on_menu_event(|app, event| {
                let id = event.id().as_ref().to_string();
                match id.as_str() {
                    "settings" => show_settings(app),
                    "quit" => app.exit(0),
                    _ => tray_action(app.clone(), id),
                }
            });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            app.manage(TrayItems { version, update: update_status, services, install });

            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                refresh_tray(&handle);
                std::thread::sleep(Duration::from_secs(60));
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the AOS tray")
        .run(|_app, event| {
            // Closing the settings window must not quit the tray app.
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
