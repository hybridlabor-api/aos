# 🔒 Reference Guide: Distributed File Locking & Concurrency Control

**Pattern**: Pattern 2 — Mutual Exclusion & Concurrency Control  
**Module**: `bdb-cicd-resilience/locking`  
**Authoritative Source**: BDB Agent OS Concurrency Specification

---

## 1. Overview & Problem Statement

In the BDB Agent OS multi-agent ecosystem, multiple autonomous agents, terminal sessions, and worktree subprocesses operate concurrently. Without rigorous synchronization, concurrent access to shared resources leads to critical data corruption:
- **`production_artifacts/state.json` Overwrites**: Parallel agents clobbering each other's status, findings, and phase transitions.
- **Git Branch & Worktree Collisions**: Concurrent `git checkout`, `git commit`, or branch operations producing index lock contention (`.git/index.lock`).
- **Database Migration Races**: Competing processes applying conflicting schema alterations simultaneously.

The Distributed Locking Engine provides deterministic mutual exclusion using atomic POSIX/APFS filesystem primitives, configurable lease timeouts, background heartbeat renewals, monotonic fencing tokens, and safe stale/orphan lock eviction.

---

## 2. Deterministic Atomic Locking Mechanics

### POSIX Atomic Test-and-Set
File creation with the flags `O_CREAT | O_EXCL` (Node.js flag `'wx'`) is guaranteed by POSIX and APFS kernel implementations to be strictly atomic.

```
Worker A (Attempt Acquire)                    Worker B (Attempt Acquire)
           │                                             │
           ├─────────────────────┬───────────────────────┤
           │                     │                       │
           ▼                     ▼                       ▼
    [ open('...lock', 'wx') ]                 [ open('...lock', 'wx') ]
           │                                             │
     Kernel Awards                                 Kernel Rejects
  File Descriptor (FD)                            with code EEXIST
           │                                             │
           ▼                                             ▼
  [ Writes Metadata JSON ]                     [ Inspects Lock / Enters ]
  [ Enters Critical Sec  ]                     [ Polling Backoff Retry  ]
```

If the lockfile already exists, the OS kernel immediately fails the call with `EEXIST` without modifying the target file, ensuring zero window for race conditions.

### Pre-Serialization, and the window that remains
1. The complete metadata JSON payload is formatted in memory *before* `fs.open(lockPath, 'wx')` is invoked.
2. The payload is written through the returned file descriptor and `fsync`'d (`fileHandle.sync()`) **before the handle is published to the caller**.
3. The descriptor is then **retained**, not closed. It is handed to the heartbeat manager and closed in `release()`. Every renewal writes through it, so a renewal can only ever land on the inode this holder created — never on whatever file currently occupies the path.

What step 2 does *not* guarantee: the **containing directory is not `fsync`'d**, so on ext4 the directory entry itself may not survive a power cut. That is deliberate and is the safe failure direction here — a missing lock is recoverable, a phantom lock is not.

The gap between `open('wx')` and the payload write is a real 0-byte window and cannot be closed from the writer side: `O_CREAT | O_EXCL` is the only atomic create-if-not-exists primitive available, and replacing it with temp+`rename()` would destroy mutual exclusion, because `rename()` overwrites its target unconditionally and every contender would win. The window is closed from the **reader** side instead, by the unreadable-lock grace in §4.

### Structured Lock Metadata Schema
```json
{
  "lockId": "7f8b9e20-94d3-4f2a-8b1a-9f5e1284d0a1",
  "resource": "production_artifacts/state.json",
  "ownerId": "pid_28419_9f5e1284",
  "pid": 28419,
  "acquiredAt": 1757083200000,
  "heartbeatAt": 1757083210000,
  "ttlMs": 10000,
  "fencingToken": 42,
  "hostname": "denck-studio.local"
}
```

- **There is no `leaseExpiresAt` field.** The lease expiry is *derived* — `heartbeatAt + ttlMs` — and evaluated at the point of use. Storing it as well would create a second source of truth that can disagree with its own inputs on every heartbeat.
- **`fencingToken`**: Monotonically increasing integer, allocated per lock path. **Advisory only** — see §7.
- **`pid`** / **`hostname`**: Used together for liveness verification during eviction. The PID is only probed when `hostname` matches the local host, because PIDs are not meaningful across machines.

### Lease expiry as seen by the holder

`handle.isExpired()` does **not** read `heartbeatAt` from the metadata: that value is frozen at acquisition and only moved by `extend()`, so a healthy, actively-renewing lock would report expired the moment `ttlMs` elapsed. It reads the heartbeat manager's `lastRenewedAt` instead — the timestamp of the last write+truncate that actually resolved:

```
isExpired() === released || lockLost || Date.now() > lastRenewedAt + ttlMs
```

`withStateLock` relies on this: after the updater returns and before the state file is written, it throws rather than write if the lease was lost while the updater ran.

---

## 3. Lease Timeouts (TTL) & Background Heartbeat Renewal

Static lockfiles are vulnerable to permanent deadlocks if the holding process crashes or is forcefully terminated (`SIGKILL`). The engine solves this using expiring leases backed by active background heartbeat renewal.

### Heartbeat Renewal Architecture
1. **Configurable TTL**: The code default is **`10,000 ms`** (`ttlMs` in `LockAcquisitionOptions`). That is aggressive for CI workloads, where a single step can block on a network call for longer than 10 s; **raise it explicitly** for CI-held locks. The default is a candidate for revision once real hold times are measurable against AOS.
2. **Periodic Renewal Interval**: `heartbeatIntervalMs` defaults to `Math.max(10, Math.floor(ttlMs / 3))` — i.e. TTL/3 with a 10 ms floor, so a very short TTL cannot produce a busy timer.
3. **In-place write through the retained descriptor.** Renewal does **not** use a temporary file and does **not** `rename()`. It writes the new payload at offset 0 through the fd retained from acquisition, then `truncate()`s to the new byte length. A tempfile+rename renewal would write by *path*, which is exactly how a holder ends up clobbering a successor's lock.

Each tick:

| Step | Condition | Outcome |
|---|---|---|
| 1 | read the file **by path**; `ENOENT` | lock lost |
| 2 | present but unparseable | **skip the tick** — no write, no truncate, no `lastRenewedAt` advance, and *not* lock-lost |
| 3 | `lockId` in the file ≠ our own | lock lost (evicted or stolen) |
| 4 | match | `write(payload, 0)` through the fd, `truncate(Buffer.byteLength(payload))`, then record `lastRenewedAt` |

**Step 2 is deliberate.** Step 1 reads by path and can legitimately catch a successor mid-write; treating one torn read as terminal would make a healthy lock self-evict. Skipping is not silent either — `lastRenewedAt` stops advancing, so *persistent* unparseability still terminates the lease exactly one `ttlMs` later through the ordinary expiry path.

**The truncate in step 4 is not optional.** Writing a shorter payload at offset 0 leaves the tail of the previous one behind, producing permanently invalid JSON — which the §4 grace then hides for its full window, because these very writes keep refreshing `mtime`. `extend()` uses the same write+truncate and records `lastRenewedAt` only after **both** resolve, for the same reason.

"Lock lost" means: stop the timer, close the fd, mark the handle released, fire `onEvicted`, and make `isExpired()` return `true`.

```
       [ Active Lock Lease (TTL: 15s) ]
  0s   ├──────────────────────────────────────────────────┤ 15s
       │                                                  │
       ▼ (Heartbeat @ 5s)                                 │
  5s   ├── In-place write + truncate (own fd) ────────────┤ 20s
       │                                                  │
       ▼ (Heartbeat @ 10s)                                │
  10s  ├── In-place write + truncate (own fd) ────────────┤ 25s
```

### Release ordering

`release()` sequences **stop heartbeat → close fd → unlink**, and that ordering satisfies two unrelated constraints at once. A refactor can satisfy either while breaking the other, and neither break is visible on the other's platform:

1. **Stop before unlink** — otherwise a tick firing between the unlink and the stop reads `ENOENT` and fires `onEvicted` on a lock that was released normally: a self-inflicted false eviction signal.
2. **Close before unlink** — otherwise Windows leaves a pending-delete entry and the next `open(lockPath, 'wx')` fails `EEXIST` against a file that is logically already gone.

If the lease was already lost, `release()` skips the unlink entirely: the file at that path belongs to a successor now.

---

## 4. Safe Stale & Orphaned Lock Eviction Protocol

When an agent encounters an existing lockfile, it must verify whether the lock is actively held or orphaned.

**Eviction is detection, not prevention.** Step 6 narrows the decide-then-break window; it does not close it. Two processes on a POSIX filesystem cannot make "decide stale" and "break" one atomic operation without a shared arbiter. The actual guarantee is weaker and worth stating plainly: an owner whose live lock is wrongly broken **learns within one heartbeat interval**, via renewal step 3.

### Multi-Step Eviction Verification
1. **Existence**: `stat` the lockfile. `ENOENT` ⇒ `{evicted: false, reason: "not_found"}`.
2. **Unreadable-lock grace**: a 0-byte *or* unparseable-JSON lockfile is evicted only once `Date.now() - stat.mtimeMs > grace`, where `grace = max(1000, callerTtlMs ?? 10000)`. Otherwise `not_stale`. This is what closes the 0-byte creation window from §2 without a debounce.
3. **Process liveness**: inspect `lock.pid`, and only if `lock.hostname` is absent or matches the local host. Send POSIX signal 0 (`process.kill(pid, 0)`); `ESRCH` means the holding process is dead.
4. **Clock-skew clamp**: `effectiveHeartbeat = Math.min(lock.heartbeatAt, Date.now())`. **There is no skew tolerance constant** — a future-dated heartbeat is clamped to now, and liveness and TTL both still run against it.
5. **Lease floor**: `effectiveTtl = Math.max(callerTtlMs ?? 0, lock.ttlMs ?? 10000)`. A contender may *lengthen* the grace it extends to a holder; it may never *shorten* the lease the holder recorded. The lease is a property of the owner.
6. **Revalidate immediately before the break**: re-read the file and compare `lockId` and `heartbeatAt` against the values the staleness decision was made on. Any change ⇒ `{evicted: false, reason: "race_lost"}` — most often a stalled holder that resumed and renewed.
7. **Atomic rename break protocol**:
   - Competing evictors never call `fs.unlink()` directly, as multiple processes could race and unlink a newly acquired legitimate lock.
   - The evictor renames the stale lockfile to a unique quarantine path: `.evict.<uuid>`.
   - Exactly one evictor succeeds. A competing evictor receives `ENOENT` — or, on Windows, `EPERM`/`EBUSY` because another process still holds the file open — and reports `reason: "race_lost"` in either case.
   - The winning evictor immediately unlinks the quarantine file, and the caller retries acquisition.

#### Why step 2 discriminates at all

The grace tells crash debris apart from a live holder **only because renewal writes in place and therefore refreshes the file's `mtime` on every tick**. A live holder's unreadable moment is always young relative to `mtime`; genuine debris ages without bound because nothing writes to it. Do not make renewal lazy, conditional, or optional without re-deriving this check — it silently degrades into "evict anything unreadable after 1 s".

Step 2 also cannot apply step 5's protection: there is by definition no parseable `ttlMs` to defend. When a contender passes a short TTL, **the 1000 ms floor is doing all of the safety work**, and a holder stalled mid-write for more than 1 s is evictable regardless of the lease it recorded. The window being protected is a single `write()` on an already-open fd, three orders of magnitude under the floor — a real ceiling, not a proof.

### Clock skew, stated as a change of direction

Earlier revisions of this guide documented a `+60000 ms` skew tolerance and said a future-dated lock was "treated as invalid". The code did neither: it returned `not_stale` for anything more than 1 s in the future, which made every future-dated lock **immortal — including one whose holder was provably dead**. Both the tolerance and that early return are gone. Step 4 clamps instead, so no number survives to be tuned.

---

## 5. State Partitioning vs. Locking in BDB Agent OS

The BDB ecosystem balances coarse-grained locking with fine-grained partition isolation:

```
+---------------------------------------------------------------------------------------+
|                               Concurrency Strategy Selection                           |
+-------------------------------------------+-------------------------------------------+
                                            |
           ┌────────────────────────────────┴────────────────────────────────┐
           ▼                                                                 ▼
┌──────────────────────────────────────┐          ┌──────────────────────────────────────┐
│       Parallel Build Fan-Out         │          │     Shared Mutable Resources         │
│  (Engineering, UI/UX, Media Nodes)   │          │  (state.json, git branches, worktree)│
├──────────────────────────────────────┤          ├──────────────────────────────────────┤
│ Strategy: State Partitioning         │          │ Strategy: Distributed File Locking   │
│ Each node writes isolated fragment:  │          │ Wrap mutation in withStateLock, which│
│ production_artifacts/state.d/<id>.json│         │ serializes on the lock and writes the │
│ Followed by single merge agent       │          │ STATE FILE via temp+rename           │
└──────────────────────────────────────┘          └──────────────────────────────────────┘
```

---

## 6. TypeScript API Usage Examples

### Guarding Shared State Mutation
```typescript
import { withStateLock } from 'bdb-cicd-resilience/locking/index.js';

await withStateLock(
  'production_artifacts/state.json',
  async (state) => {
    state.phase = 'build';
    state.artifacts.backend = 'production_artifacts/02_backend_schema.md';
    state.findings.push({ id: 'F-ENG-02', status: 'fixed' });
    return state; // Automatically written back via atomic rename
  },
  { ttlMs: 15000, acquireTimeoutMs: 10000 }
);
```

### Resource Guard with Auto-Eviction
```typescript
import { acquireLock } from 'bdb-cicd-resilience/locking/index.js';

const handle = await acquireLock('git_worktree_main', {
  lockDir: '.git/locks',
  ttlMs: 20000,
  acquireTimeoutMs: 15000,
  retryIntervalMs: 100,
});

try {
  // Critical section
  await performGitOperations();
} finally {
  await handle.release();
}
```

### Inspecting a lock without taking it
`inspectLock(resource, { lockDir })` returns the parsed metadata, or `null`. Because renewal writes in place, a reader can catch a torn write, so `inspectLock` **re-reads once after ~5 ms** before answering `null`. An unreadable lock is not evidence of no lock — the same argument as the §4 eviction grace, applied to a public query.

---

## 7. Known limitations

These are load-bearing and deliberately not engineered away in this cycle. Do not design against a stronger guarantee than the ones listed here.

- **Fencing tokens are advisory.** No resource in this library verifies a token, and the `.seq` counter backing them is written with a plain `writeFile` whose failure is swallowed — it is **not crash-durable**. Tokens are also allocated *before* the `open('wx')` attempt, so every losing poll burns one. They are strictly increasing per process, non-decreasing across a run, and **must not be relied on for cross-host safety** until some resource actually validates them.
- **The default lock directory is `process.cwd()/.locks/`.** It follows the working directory of whichever process acquires, which is not the same thing as following the resource.
- **No re-entrancy.** A second acquisition of a path already held by the same process fast-rejects without touching the filesystem. That is correct for a mutex, but it means a sibling async task in the same process fails fast rather than queuing. Distinguishing "same logical caller re-entering" from "sibling task waiting" needs a caller identity that no consumer currently supplies.
- **`HeartbeatManager` is not part of the public barrel.** It requires the `lockId` and the fd from the acquiring `open('wx')`, neither of which a caller that did not acquire the lock can synthesise. That removes the *accidental* path to renewing someone else's lock, not the determined one — a caller can still open the path `r+` and copy the `lockId` out of the file. No file-based lock can prevent that.
- **The containing directory is not `fsync`'d** on acquisition (§2).
- **Windows behaviour is unverified.** The `EPERM`/`EBUSY` handling in the break protocol and in `release()` exists to be correct on Windows, but has never been executed on a Windows host.
