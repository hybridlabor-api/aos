---
name: rust-pro
description: "Use when writing, debugging or structuring Rust: ownership and borrow-checker errors, error handling, async/tokio, cargo workflow, unsafe code, or Tauri v2 backends."
category: library
source: community
---
# Rust Pro

Guide for **writing** Rust. For reviewing a finished diff use the `rust-reviewer` agent; this skill does not duplicate its checklist.

## 1. Workflow

Run in this order and fix each stage before moving on:

```sh
cargo check --all-targets --all-features   # fast type/borrow errors
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all
cargo test --all-features                  # unit + integration + doc tests
```

- Read the **first** compiler error only; later ones are often cascades.
- `cargo clippy` lints are advice with reasons. Fix the cause; use `#[allow(clippy::x)]` only with a one-line why.
- Multi-crate repos: use a `[workspace]` with `[workspace.dependencies]` so versions live in one place; members use `dep = { workspace = true }`.
- Features must be additive. Never make a feature remove behavior or change a public type. Test with `--no-default-features` and `--all-features`.
- Check `edition` and `rust-version` in `Cargo.toml` before using newer syntax or std APIs; edition 2024 exists and changes some defaults, so do not bump an edition as a drive-by.
- Dependency hygiene: `cargo tree -d` (duplicates), `cargo tree -i <crate>` (who pulls it), `cargo audit` (needs the `cargo-audit` tool installed).
- Commit `Cargo.lock` for binaries and apps.

## 2. Ownership and borrow-checker triage

Read the error as three facts: **which value**, **who borrowed it**, **where the conflicting use is**. The fix is almost always to shorten a borrow, not to add syntax.

| Symptom | Usual fix |
|---|---|
| `cannot borrow as mutable because also borrowed as immutable` | End the first borrow earlier: copy out the needed value, or split into two statements |
| `use of moved value` | Pass `&T`; or `.clone()` if the value is cheap/small; or restructure so the last use moves |
| `borrowed value does not live long enough` | Return an owned value (`String`, `Vec`) instead of a reference to a local |
| `missing lifetime specifier` | One input reference: elided. Several: name the one the output borrows from |
| Data needed on several threads/owners | `Arc<T>` (shared, immutable), `Arc<Mutex<T>>` (shared, mutable) |
| Single-threaded shared ownership | `Rc<T>`, `Rc<RefCell<T>>` (runtime-checked; panics on double mutable borrow) |

Rules of thumb:

- Take `&str`, `&[T]`, `&Path` in parameters; return owned types.
- `.clone()` to silence the borrow checker is acceptable once, deliberately, off the hot path. Add it only after you know which borrow conflicts.
- Structs holding references need a lifetime (`struct Parser<'a> { src: &'a str }`). If that spreads through the whole program, store owned data instead.
- Avoid self-referential structs. Store indices or ids into a `Vec`, or split the owner and the borrower into two values.
- Iterate with iterators, not `v[i]`: `for x in &v`, `v.iter().map(..).collect::<Vec<_>>()`, `v.iter_mut()`. Indexing hides borrows and adds bounds checks.
- Mutate while looping: collect changes first (`retain`, `drain`, or a second pass), then apply.
- `Cow<'_, str>` when a function sometimes allocates and sometimes borrows.

## 3. Error handling

- **Libraries**: a typed enum with `thiserror`. **Applications**: `anyhow::Result` plus context.
- Propagate with `?`; add context at the boundary where the cause would be unclear.

```rust
use anyhow::{Context, Result};
use std::path::Path;

fn load(path: &Path) -> Result<String> {
    std::fs::read_to_string(path)
        .with_context(|| format!("reading {}", path.display()))
}
```

```rust
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid value for {key}")]
    Invalid { key: String },
}
```

- No `unwrap()` / `expect()` in non-test code. Allowed exceptions: provably infallible cases with an `expect("why this cannot fail")`, and startup invariants where aborting is the intent.
- Do not return `Box<dyn Error>` from a library; callers cannot match on it.
- Never swallow errors with `let _ = ...` on a `Result` unless failure is truly irrelevant, and then say why.
- Panics are for bugs, not for expected failure (missing file, bad input, network).

## 4. Async (tokio)

```toml
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time"] }
```

- `#[tokio::main]` for binaries, `#[tokio::test]` for async tests. Inside Tauri, use Tauri's runtime (see section 7) rather than a second one.
- **Never block the runtime.** Blocking file/CPU/sync-lib work goes in `tokio::task::spawn_blocking`; `std::thread::sleep` and heavy loops inside `async fn` stall every task on that worker.
- Do not hold a `std::sync::MutexGuard` across `.await`. Scope the lock in a block, or use `tokio::sync::Mutex` when the lock must span an await.
- `tokio::spawn` requires the future to be `Send + 'static`. Errors like "future cannot be sent between threads" usually mean a non-`Send` value (`Rc`, a guard) lives across an `.await`; drop it before the await.
- Channels: `tokio::sync::mpsc` for work queues (use bounded channels for backpressure), `oneshot` for a single reply, `watch` for latest-value state, `broadcast` for fan-out.
- `tokio::select!` drops the losing branches. Only put **cancellation-safe** futures in it (mpsc `recv`, `sleep`, oneshot are; check the docs for each API's "Cancel safety" section before using others). Keep partially-read state outside the future.

```rust
use std::time::Duration;
use tokio::{select, sync::mpsc, time::sleep};

async fn run(mut rx: mpsc::Receiver<String>) {
    loop {
        select! {
            Some(msg) = rx.recv() => handle(msg).await,
            _ = sleep(Duration::from_secs(30)) => tick().await,
            else => break,
        }
    }
}

async fn handle(_: String) {}
async fn tick() {}
```

- Join handles: `.await` them or the task's panic/error is lost. Use `JoinSet` for groups.
- Add timeouts to every network call: `tokio::time::timeout(dur, fut).await`.

## 5. Unsafe

- Default: do not write `unsafe`. Reach for a safe crate or std API first.
- Allowed when required for FFI, a proven hot path, or a data structure the borrow checker cannot express.
- Every `unsafe` block gets a `// SAFETY:` comment stating the invariant that makes it sound and why it holds here. Every `unsafe fn` documents its caller obligations under `# Safety`.
- Keep the block as small as possible and wrap it in a safe API that enforces the invariant; the rest of the crate stays safe.
- Test unsafe code under Miri (`cargo +nightly miri test`) and concurrent primitives under `loom`.

## 6. Testing and performance

- Unit tests live next to the code in `#[cfg(test)] mod tests`; integration tests in `tests/`; examples in doc comments run as doc tests.
- Test error paths, not just success. Return `Result<(), Box<dyn std::error::Error>>` from tests to use `?`.
- Property tests: `proptest` for parsers, serializers, round-trips.
- **Profile before optimising.** Benchmark with `criterion` (or the built-in `#[bench]` on nightly only), and look at a flamegraph before changing code.
- Typical real wins: avoid needless allocation (`with_capacity`, reuse buffers), iterate instead of collecting, pass references.
- Release profile knobs, measured one at a time:

```toml
[profile.release]
lto = "thin"
codegen-units = 1
# panic = "abort"   # smaller binary; disables unwinding, breaks catch_unwind
```

Benchmark with `--release`; debug builds are not representative.

## 7. Tauri v2 backend

Docs: https://v2.tauri.app (check it for current plugin and permission names; do not guess identifiers).

Commands, state and a serializable error type:

```rust
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("invalid note name: {0}")]
    InvalidName(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

#[derive(Default)]
struct Counter(Mutex<u32>);

#[tauri::command]
fn bump(state: State<'_, Counter>) -> u32 {
    let mut n = state.0.lock().unwrap_or_else(|e| e.into_inner());
    *n += 1;
    *n
}

#[tauri::command]
async fn read_note(name: String) -> Result<String, AppError> {
    // Accept a single plain file name only: no separators, no `..`, no absolute paths.
    let mut parts = std::path::Path::new(&name).components();
    match (parts.next(), parts.next()) {
        (Some(std::path::Component::Normal(_)), None) => {}
        _ => return Err(AppError::InvalidName(name)),
    }
    let path = std::path::Path::new("notes").join(&name);
    Ok(tokio::fs::read_to_string(path).await?) // needs tokio feature "fs"
}

fn main() {
    tauri::Builder::default()
        .manage(Counter::default())
        .invoke_handler(tauri::generate_handler![bump, read_note])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- Commands return `Result<T, E>` where `E: Serialize`; plain `String` errors also work. Async commands that borrow arguments (`&str`, `State<'_, _>`) must return `Result`.
- Command arguments and return types go over IPC as JSON: derive `serde::Serialize` / `Deserialize` on them. The frontend passes arguments as camelCase keys by default.
- Use `State<'_, T>` with `.manage(..)` for shared data; wrap mutable state in `Mutex`/`RwLock`. Prefer `std::sync::Mutex` unless the lock must be held across an `.await`.
- Long jobs: do not block a command. Spawn the work and report progress with events (`use tauri::Emitter; app.emit("progress", payload)?` using an `AppHandle`), or return when done and let the frontend await.
- **Capabilities**: v2 denies by default. Grant what the webview may call in JSON files under `src-tauri/capabilities/` (each has an `identifier`, target `windows`, and a `permissions` list). Add the narrowest permission that works; do not grant blanket access to make an error go away.
- **Secrets stay in Rust.** API keys, tokens and credentials are read and used in the backend; the webview gets results, never the secret. Treat every command argument as untrusted input: validate paths (no `..` escapes), sizes and enums.
- Keep commands thin: parse input, call a plain Rust function that is unit-testable without Tauri, map the error.
- Driving and testing a running dev app (clicking, reading the DOM, screenshots) is the job of the `tauri-pilot` skill; use it instead of ad-hoc scripts once `cargo tauri dev` is running.

## 8. Do not

- Do not `.clone()` or `Rc/Arc` everything to get past the compiler without understanding the borrow.
- Do not `unwrap()` outside tests and proven invariants.
- Do not block inside `async fn`, or hold a std mutex guard across `.await`.
- Do not write `unsafe` without a `// SAFETY:` comment and a safe wrapper.
- Do not silence clippy globally; fix or allow per-item with a reason.
- Do not add a dependency for a few lines of std; check `cargo tree` before and after adding one.
- Do not invent crate APIs or feature flags: read the docs.rs page or `cargo doc --open` for the version in `Cargo.lock`.
- Do not expose secrets or broad filesystem/shell permissions to the Tauri webview.
