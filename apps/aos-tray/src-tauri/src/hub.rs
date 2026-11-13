//! Store screen: the AOS hub (lib/hub) in its own window labelled "hub". That window has no
//! capability file entry, so it gets no IPC; the hub keeps its own token and Origin guards.
//! Pure helpers only; the window glue lives in app.rs.

/// Label of the hub window. Must never appear in capabilities/*.json.
pub const WINDOW_LABEL: &str = "hub";

/// Default hub port (bin/aos-hub.mjs DEFAULT_PORT).
pub const DEFAULT_PORT: u16 = 7900;

pub fn hub_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/")
}

/// The hub window may only navigate inside the hub origin. Anything else is refused (links to
/// the web open nowhere instead of inside a window that talks to the local hub).
pub fn navigation_allowed(url: &str, port: u16) -> bool {
    let origin = format!("http://127.0.0.1:{port}");
    match url.strip_prefix(&origin) {
        Some(rest) => rest.is_empty() || rest.starts_with('/') || rest.starts_with('?') || rest.starts_with('#'),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_and_navigation() {
        assert_eq!(hub_url(7900), "http://127.0.0.1:7900/");
        assert!(navigation_allowed("http://127.0.0.1:7900/", 7900));
        assert!(navigation_allowed("http://127.0.0.1:7900/?tab=store", 7900));
        assert!(navigation_allowed("http://127.0.0.1:7900", 7900));
        assert!(!navigation_allowed("http://127.0.0.1:79001/", 7900));
        assert!(!navigation_allowed("http://127.0.0.1:7900.evil.test/", 7900));
        assert!(!navigation_allowed("http://127.0.0.1:7900@evil.test/", 7900));
        assert!(!navigation_allowed("http://localhost:7900/", 7900));
        assert!(!navigation_allowed("https://example.com/", 7900));
        assert!(!navigation_allowed("file:///etc/passwd", 7900));
    }
}
