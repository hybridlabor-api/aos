fn main() {
    // tauri-build only for the app; the pure library and its tests build without it.
    #[cfg(feature = "app")]
    tauri_build::build()
}
