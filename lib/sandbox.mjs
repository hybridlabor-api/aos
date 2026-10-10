// Optional per-launch sandbox for aos-acp (--sandbox <provider>). Off by default.
import { spawnSync } from "node:child_process";

const defaultWhich = (bin) => {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
};

export const winToWslPath = (p) => {
  // UNC and \\?\ paths have no /mnt/<drive> form; refuse rather than emit a wrong path.
  if (/^[\\/]{2}/.test(p)) throw new Error(`wsl2 sandbox needs a drive path, not ${p}`);
  const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(p);
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`.replace(/\/$/, "") : p.replace(/\\/g, "/");
};

export const PROVIDERS = {
  coop: {
    available(platform, which, env = process.env) {
      if (platform !== "darwin" && platform !== "linux") return { ok: false, reason: `coop runs on macOS/Linux, not ${platform}` };
      if (!which("coop")) return { ok: false, reason: "coop binary not found on PATH (install a pinned release: https://github.com/trailofbits/coop)" };
      if (!env.AOS_SANDBOX_COOP_CMD) return { ok: false, reason: "AOS_SANDBOX_COOP_CMD is unset: the coop v0.8.0 README documents no run-a-command form, so set a template, e.g. 'coop <subcommand> {cwd} -- {cmd}' from `coop --help`" };
      if (!env.AOS_SANDBOX_COOP_CMD.trim().split(/\s+/).includes("{cmd}")) return { ok: false, reason: "AOS_SANDBOX_COOP_CMD must contain {cmd} as its own whitespace-separated token" };
      return { ok: true };
    },
    // coop v0.8.0 README (https://github.com/trailofbits/coop/blob/v0.8.0/README.md, "Usage") documents only `coop up` / `coop claude`; no run-command form, so the template comes from AOS_SANDBOX_COOP_CMD.
    wrap(cmd, { cwd, env = process.env }) {
      const tpl = env.AOS_SANDBOX_COOP_CMD;
      if (!tpl) throw new Error("AOS_SANDBOX_COOP_CMD is unset");
      return tpl.trim().split(/\s+/).flatMap((t) => (t === "{cmd}" ? cmd : [t.replaceAll("{cwd}", () => cwd)]));
    },
  },
  wsl2: {
    available(platform, which) {
      if (platform !== "win32") return { ok: false, reason: `wsl2 is only available on Windows, not ${platform}` };
      if (!which("wsl.exe")) return { ok: false, reason: "WSL2 not found (wsl.exe is not on PATH); no sandbox available on this machine" };
      return { ok: true };
    },
    // `wsl.exe --cd <dir> --exec <cmd...>` (wsl --help): --exec runs argv without the Linux shell, so prompts are not re-split.
    // Unverified on a real Windows machine.
    wrap(cmd, { cwd }) {
      return ["wsl.exe", "--cd", winToWslPath(cwd), "--exec", ...cmd];
    },
  },
};

export function resolveSandbox(name, { platform = process.platform, which = defaultWhich, env = process.env } = {}) {
  const p = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
  if (!p) throw new Error(`unknown sandbox provider "${name}" (${Object.keys(PROVIDERS).join("|")})`);
  const a = p.available(platform, which, env);
  if (!a.ok) throw new Error(`sandbox "${name}" unavailable: ${a.reason}`);
  return p;
}
