import * as nodeFs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROFILES = ["strict", "work", "off"];
export const MAX_CONFIG_BYTES = 4096;
const H = 3600 * 1000;
export const LIMITS = {
  work: { defaultMs: 4 * H, maxMs: 24 * H },
  off: { defaultMs: 1 * H, maxMs: 2 * H },
};

// Command classes that still need Tim under `work`. Data only; the gate decides how to match them.
export const RELEASE_CLASS = Object.freeze([
  { id: "push-protected", desc: "git push to the default branch, main/master or release/*" },
  { id: "npm-publish", desc: "npm publish" },
  { id: "npm-version", desc: "npm version" },
  { id: "npm-dist-tag", desc: "npm dist-tag add/rm" },
  { id: "gh-pr-merge", desc: "gh pr merge" },
  { id: "gh-release-create", desc: "gh release create" },
  { id: "destructive-delete", desc: "recursive delete, bulk move out of home, delete outside the own worktree" },
]);

// ~/.aos/gate/config.json
export const defaultConfigFile = () => join(homedir(), ".aos/gate/config.json");

const strict = (reason) => ({ profile: "strict", reason });

export function readProfile({ file = defaultConfigFile(), now = Date.now(), uid = process.getuid?.(), fs = nodeFs } = {}) {
  const C = fs.constants;
  let fd;
  let text;
  let st;
  try {
    if (process.platform === "win32" && fs.lstatSync(file).isSymbolicLink()) return strict("config is a symlink"); // O_NOFOLLOW is a no-op on Windows
    fd = fs.openSync(file, C.O_RDONLY | C.O_NONBLOCK | C.O_NOFOLLOW);
    st = fs.fstatSync(fd);
    if (!st.isFile()) return strict("not a regular file");
    if (st.size > MAX_CONFIG_BYTES) return strict("file too large");
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) { const k = fs.readSync(fd, buf, n, st.size - n, n); if (!k) break; n += k; }
    text = buf.toString("utf8", 0, n);
  } catch (e) {
    return strict(e.code === "ENOENT" ? "no config (default)" : e.code === "ELOOP" ? "config is a symlink" : "unreadable");
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
  if (process.platform !== "win32") {
    if ((st.mode & 0o777) !== 0o600) return strict("wrong mode (need 0600)");
    if (uid === undefined || st.uid !== uid) return strict("wrong owner");
  }
  let c;
  try { c = JSON.parse(text); } catch { return strict("corrupt JSON"); }
  if (!c || typeof c !== "object" || Array.isArray(c) || c.version !== 1) return strict("bad schema");
  if (!PROFILES.includes(c.profile)) return strict("unknown profile");
  const setAt = typeof c.set_at === "string" ? Date.parse(c.set_at) : NaN;
  if (!Number.isFinite(setAt)) return strict("bad set_at");
  if (setAt > now) return strict("set_at in the future");
  if (c.profile === "strict") return { profile: "strict", reason: null, set_at: c.set_at, expires_at: null, set_by: c.set_by ?? null };
  const exp = typeof c.expires_at === "string" ? Date.parse(c.expires_at) : NaN;
  if (!Number.isFinite(exp)) return strict("missing expiry");
  if (exp <= now) return strict("expired");
  if (exp - setAt > LIMITS[c.profile].maxMs) return strict("expiry beyond maximum");
  return { profile: c.profile, reason: null, set_at: c.set_at, expires_at: c.expires_at, set_by: c.set_by ?? null, remaining_ms: exp - now };
}

export const profileFor = (now = Date.now(), opts = {}) => readProfile({ ...opts, now });
