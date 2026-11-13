//! AOS tray. The pure modules build without Tauri so `cargo test --no-default-features`
//! runs them on any OS; the tray and window glue needs the default `app` feature.

pub mod agents_md;
pub mod awake;
pub mod cli;
pub mod codenotch;
pub mod elevation;
pub mod hub;
pub mod hubapi;
pub mod projects;
pub mod router;
pub mod secrets;
pub mod state;

#[cfg(feature = "app")]
mod app;
#[cfg(feature = "app")]
pub use app::run;
