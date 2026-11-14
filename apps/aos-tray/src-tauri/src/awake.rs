//! "Always on": keeps the computer from going to sleep while the app runs.
//!
//! The decision logic (`Mode`, `holds`, `normalize`) is pure and unit-tested. The OS call lives
//! in `Holder`: Windows uses SetThreadExecutionState on one dedicated thread (the flag belongs to
//! the calling thread, so the same thread must set and clear it); macOS runs `caffeinate -i` and
//! kills it when the hold ends. Other systems hold nothing and report that they are unsupported.

use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

/// What the user asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "until", rename_all = "lowercase")]
pub enum Mode {
    Off,
    On,
    /// Hold until this Unix time (seconds), then fall back to `Off`.
    Until(i64),
}

impl Default for Mode {
    fn default() -> Self {
        Mode::Off
    }
}

/// Whether the computer must stay awake at `now` (Unix seconds).
pub fn holds(mode: Mode, now: i64) -> bool {
    match mode {
        Mode::Off => false,
        Mode::On => true,
        Mode::Until(t) => t > now,
    }
}

/// An expired timer reverts to `Off`; everything else is unchanged.
pub fn normalize(mode: Mode, now: i64) -> Mode {
    match mode {
        Mode::Until(t) if t <= now => Mode::Off,
        m => m,
    }
}

/// A timer of `minutes` from `now`. Zero or more than one week is refused.
pub fn timer(now: i64, minutes: u32) -> Result<Mode, String> {
    if minutes == 0 {
        return Err("duration must be at least one minute".into());
    }
    if minutes > 7 * 24 * 60 {
        return Err("duration must be at most one week".into());
    }
    Ok(Mode::Until(now + i64::from(minutes) * 60))
}

pub fn supported() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

pub fn now_unix() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// File content of the saved mode; lenient: anything unreadable means `Off`.
pub fn parse_saved(text: &str) -> Mode {
    serde_json::from_str(text).unwrap_or_default()
}

enum Cmd {
    Set(Mode),
    Quit,
}

/// Owns the thread that holds the OS assertion. `stop` (also run on drop) releases the hold
/// and waits for the thread, so nothing is left behind when the app quits.
pub struct Holder {
    tx: Sender<Cmd>,
    thread: std::sync::Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Holder {
    pub fn start() -> Holder {
        let (tx, rx) = mpsc::channel::<Cmd>();
        let thread = std::thread::spawn(move || {
            let mut mode = Mode::Off;
            let mut held = false;
            let mut os = os::Hold::new();
            loop {
                match rx.recv_timeout(Duration::from_secs(5)) {
                    Ok(Cmd::Set(m)) => mode = m,
                    Ok(Cmd::Quit) | Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {}
                }
                mode = normalize(mode, now_unix());
                let want = holds(mode, now_unix());
                // Retry every tick while the OS call failed or the helper process died.
                if want != held || (want && !os.alive()) {
                    held = want && os.set(true);
                    if !want {
                        os.set(false);
                    }
                }
            }
            os.set(false);
        });
        Holder { tx, thread: std::sync::Mutex::new(Some(thread)) }
    }

    pub fn set(&self, mode: Mode) {
        let _ = self.tx.send(Cmd::Set(mode));
    }

    /// Releases the hold and joins the thread. Safe to call more than once.
    pub fn stop(&self) {
        let _ = self.tx.send(Cmd::Quit);
        if let Ok(mut t) = self.thread.lock() {
            if let Some(h) = t.take() {
                let _ = h.join();
            }
        }
    }
}

impl Drop for Holder {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(windows)]
mod os {
    use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};

    pub struct Hold;
    impl Hold {
        pub fn new() -> Hold {
            Hold
        }
        /// Must be called from the same thread every time (the flag belongs to the thread).
        /// Returns whether the call succeeded (it returns 0 on failure).
        pub fn set(&mut self, on: bool) -> bool {
            // SAFETY: plain Win32 call with documented flag values and no pointers.
            unsafe { SetThreadExecutionState(if on { ES_CONTINUOUS | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS }) != 0 }
        }
        /// The execution state belongs to the thread and dies with it, so it is always alive.
        pub fn alive(&mut self) -> bool {
            true
        }
    }
}

#[cfg(target_os = "macos")]
mod os {
    use std::process::{Child, Command, Stdio};

    pub struct Hold(Option<Child>);
    impl Hold {
        pub fn new() -> Hold {
            Hold(None)
        }
        pub fn set(&mut self, on: bool) -> bool {
            if on {
                if self.0.is_none() {
                    // `-i` keeps the system from idle sleep. `-w <pid>` makes caffeinate exit when
                    // this app exits, even after a crash; `set(false)` also kills it.
                    let pid = std::process::id().to_string();
                    self.0 = Command::new("/usr/bin/caffeinate").args(["-i", "-w", &pid]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().ok();
                }
                self.0.is_some()
            } else {
                if let Some(mut c) = self.0.take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                true
            }
        }
        /// True while the helper process still runs; a dead one is dropped so it can be respawned.
        pub fn alive(&mut self) -> bool {
            match self.0.as_mut().map(|c| c.try_wait()) {
                Some(Ok(None)) => true,
                Some(_) => {
                    self.0 = None;
                    false
                }
                None => false,
            }
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod os {
    pub struct Hold;
    impl Hold {
        pub fn new() -> Hold {
            Hold
        }
        pub fn set(&mut self, _on: bool) -> bool {
            false
        }
        pub fn alive(&mut self) -> bool {
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_follows_the_mode() {
        assert!(!holds(Mode::Off, 100));
        assert!(holds(Mode::On, 100));
        assert!(holds(Mode::Until(101), 100));
        assert!(!holds(Mode::Until(100), 100));
        assert!(!holds(Mode::Until(50), 100));
    }

    #[test]
    fn expired_timer_reverts_to_off() {
        assert_eq!(normalize(Mode::Until(100), 100), Mode::Off);
        assert_eq!(normalize(Mode::Until(200), 100), Mode::Until(200));
        assert_eq!(normalize(Mode::On, 100), Mode::On);
    }

    #[test]
    fn timer_is_bounded() {
        assert_eq!(timer(1000, 30).unwrap(), Mode::Until(1000 + 1800));
        assert!(timer(1000, 0).is_err());
        assert!(timer(1000, 7 * 24 * 60 + 1).is_err());
        assert!(timer(1000, 7 * 24 * 60).is_ok());
    }

    #[test]
    fn saved_mode_round_trips_and_is_lenient() {
        for m in [Mode::Off, Mode::On, Mode::Until(1234)] {
            let text = serde_json::to_string(&m).unwrap();
            assert_eq!(parse_saved(&text), m);
        }
        assert_eq!(parse_saved("not json"), Mode::Off);
        assert_eq!(parse_saved("{\"kind\":\"nonsense\"}"), Mode::Off);
        assert_eq!(parse_saved(""), Mode::Off);
    }
}
