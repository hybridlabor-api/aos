// a2a-watch — strictly READ-ONLY live follower for a local A2A peer.
// Follows (1) the session log <sessionsDir>/<name>.log, (2) the peer's on-disk inbox
// under <inboxRoot>/a2a/<name>/ (never claims: no rename, ever), (3) reply files in
// replyDir(name). No writes, no deletes, no tokens in output.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { list, sessionsDir, validName } from "./a2a-registry.mjs";
import { inboxRoot, replyDir } from "./a2a-inbox.mjs";

const preview = (s) => String(s ?? "").replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 80);

const listDir = (dir, re) => {
  try { return readdirSync(dir).filter((f) => re.test(f)); } catch { return []; }
};

const last20 = (text) => {
  const lines = String(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-20).join("\n");
};

function headerLine(entry, name) {
  if (!entry) return "not registered";
  const ts = typeof entry.ts === "number" ? new Date(entry.ts).toISOString() : String(entry.ts ?? "?");
  return `peer ${name} harness=${entry.harness ?? "?"} url=${entry.url ?? "-"} status=${entry.status ?? "idle"} pid=${entry.pid ?? "?"} last heartbeat ${ts}`;
}

function findEntry(name) {
  return list().find((e) => (e.fileName ?? e.name) === validName(name)) ?? null;
}

export async function watch({
  name,
  once = false,
  out = process.stdout,
  pollMs = 500,
  signal,
} = {}) {
  const n = validName(name);
  const emit = (line) => out.write(`${line}\n`);
  emit(headerLine(findEntry(n), n));

  // --once snapshot: header + last 20 log lines + pending/delivered counts, exit 0.
  if (once) {
    if (!findEntry(n)) return 1;
    let logText = "";
    try { logText = readFileSync(join(sessionsDir(), `${n}.log`), "utf8"); } catch { /* no log yet */ }
    const tail = last20(logText);
    if (tail) emit(tail);
    let pending = 0;
    let delivered = 0;
    try {
      const dir = join(inboxRoot(), "a2a", n);
      pending = listDir(dir, /\.json$/).length;
      delivered = listDir(dir, /\.delivered$/).length;
    } catch { /* no inbox yet */ }
    emit(`inbox pending=${pending} delivered=${delivered}`);
    return 0;
  }

  if (!findEntry(n)) return 1;

  // Log: print the last 20 lines already on disk at start, then tail new bytes.
  const logFile = join(sessionsDir(), `${n}.log`);
  // Offsets are string indices on the utf8-decoded text (never mixed with byte sizes).
  let logPos = 0;
  try {
    const text = readFileSync(logFile, "utf8");
    const tail = last20(text);
    if (tail) emit(tail);
    // Everything on disk was just printed (last 20 lines): follow only what is appended from now on.
    logPos = text.length;
  } catch { logPos = 0; }

  // Inbox: seen basenames; .json flips to .delivered via the peer's own claim (we only observe).
  const inboxDir = join(inboxRoot(), "a2a", n);
  const seen = new Set();
  for (const f of listDir(inboxDir, /\.(json|delivered)$/)) seen.add(f);

  const repliesDir = replyDir(n);
  const replied = new Set(listDir(repliesDir, /\.reply$/));

  const misprinted = (s) => typeof s === "string" && /[\x00-\x1f]/.test(s.replace(/\n/g, ""));
  // already aborted before the loop started: keep exit-code semantics (abort -> 2)
  if (signal?.aborted) return 2;

  let sigAbort = false;
  const sleepers = new Set(); // resolve fns of in-flight sleeps, so abort is prompt
  const onAbort = () => {
    sigAbort = true;
    for (const done of sleepers) done();
    sleepers.clear();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  // Sleep that (a) auto-clears its timer on resolve and (b) is resolved early by abort.
  const sleep = (ms) => new Promise((res) => {
    let t = 0;
    const done = () => {
      if (t) { clearTimeout(t); t = 0; }
      sleepers.delete(done);
      res();
    };
    sleepers.add(done);
    t = setTimeout(done, ms);
  });
  try {
    while (!sigAbort && !signal?.aborted) {
      if (!findEntry(n)) { emit("peer gone"); return 0; }

      // (1) new log bytes (string offsets only, so multi-byte chars are safe)
      try {
        const full = readFileSync(logFile, "utf8");
        if (full.length < logPos) logPos = 0;
        const chunk = full.slice(logPos);
        if (chunk && !misprinted(chunk)) emit(chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk);
        logPos = full.length;
      } catch { /* log not written yet */ }

      // (2) inbox arrivals + deliveries
      const files = listDir(inboxDir, /\.(json|delivered)$/);
      for (const f of files) {
        if (seen.has(f)) continue;
        seen.add(f);
        if (f.endsWith(".delivered")) {
          let task = f.replace(/\.delivered$/, "");
          try {
            const m = JSON.parse(readFileSync(join(inboxDir, f), "utf8"));
            if (m?.taskId) task = String(m.taskId);
          } catch { /* keep basename fallback */ }
          emit(`delivered ${validName(task)}`);
          continue;
        }
        try {
          const m = JSON.parse(readFileSync(join(inboxDir, f), "utf8"));
          const who = preview(String(m.from ?? "unknown")).slice(0, 64);
          emit(`inbox  ${new Date(Number(m.ts) || Date.now()).toISOString()} from=${who} task=${validName(String(m.taskId ?? ""))} "${preview(m.text)}"`);
        } catch { /* corrupt or half-written: skip this poll */ }
      }

      // (3) reply files
      for (const f of listDir(repliesDir, /\.reply$/)) {
        if (replied.has(f)) continue;
        replied.add(f);
        let bytes = 0;
        try { bytes = statSync(join(repliesDir, f)).size; } catch { /* gone again */ }
        emit(`reply   task=${validName(f.replace(/\.reply$/, ""))} (${bytes} bytes)`);
      }

      await sleep(pollMs);
      if (sigAbort || signal?.aborted) return 2;
    }
    return 2;
  } finally {
    onAbort(); // clear any in-flight sleep timer and unblock, even when leaving via error/return
    sleepers.clear();
    signal?.removeEventListener("abort", onAbort);
  }
}
