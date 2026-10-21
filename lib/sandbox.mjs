// Optional per-launch sandbox for aos-acp (--sandbox <provider>). Off by default.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const defaultWhich = (bin) => {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8", windowsHide: true });
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

// 1. Sandbox detector:
// The gate treats a session as sandboxed only when AOS itself started it inside
// a container/VM (Docker/Podman container with /.dockerenv or /run/.containerenv
// AND an AOS sandbox marker env set by the launcher; WSL2 sandbox via the existing
// wsl2 adapter). An env var alone on the host must never count.
export function isSandboxed({
  env = process.env,
  platform = process.platform,
  existsSync: existFn = existsSync,
  readFileSync: readFn = readFileSync,
} = {}) {
  const marker = env.AOS_SANDBOX_MARKER || env.AOS_SANDBOX;
  if (!marker) return false;

  // Container detection (Docker /.dockerenv, Podman /run/.containerenv)
  try {
    if (existFn("/.dockerenv") || existFn("/run/.containerenv")) {
      return true;
    }
  } catch { /* best effort */ }

  // WSL2 sandbox detection: platform must be linux (running inside WSL2 VM)
  if (platform === "linux") {
    if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
    try {
      if (existFn("/proc/version")) {
        const v = readFn("/proc/version", "utf8");
        if (/microsoft|wsl/i.test(v)) return true;
      }
    } catch { /* best effort */ }
  }

  // An env var alone on the host must never count.
  return false;
}

// 2. Factory unattended sandbox runtime resolution:
// Docker or Podman on macOS/Linux; WSL2 or Docker on Windows.
// If no sandbox runtime is available, refuse unattended mode with a clear message and how to install one.
export function resolveFactorySandbox({
  platform = process.platform,
  which = defaultWhich,
  env = process.env,
} = {}) {
  if (platform === "darwin" || platform === "linux") {
    const dockerBin = which("docker");
    if (dockerBin) {
      return {
        ok: true,
        runtime: "docker",
        bin: dockerBin,
        wrap: (cmd, { cwd = process.cwd() } = {}) => [
          dockerBin,
          "run",
          "-i",
          "--rm",
          "-v",
          `${cwd}:${cwd}`,
          "-w",
          cwd,
          "-e",
          `AOS_SANDBOX_MARKER=${env.AOS_SANDBOX_MARKER || "1"}`,
          env.AOS_SANDBOX_IMAGE || "node:24-bookworm",
          ...cmd,
        ],
      };
    }
    const podmanBin = which("podman");
    if (podmanBin) {
      return {
        ok: true,
        runtime: "podman",
        bin: podmanBin,
        wrap: (cmd, { cwd = process.cwd() } = {}) => [
          podmanBin,
          "run",
          "-i",
          "--rm",
          "-v",
          `${cwd}:${cwd}`,
          "-w",
          cwd,
          "-e",
          `AOS_SANDBOX_MARKER=${env.AOS_SANDBOX_MARKER || "1"}`,
          env.AOS_SANDBOX_IMAGE || "node:24-bookworm",
          ...cmd,
        ],
      };
    }
    const install =
      platform === "darwin"
        ? "Install Docker Desktop (https://www.docker.com/products/docker-desktop) or Podman (`brew install podman`)."
        : "Install Docker (`apt-get install docker.io` / `dnf install docker`) or Podman (`apt-get install podman` / `dnf install podman`).";
    return {
      ok: false,
      runtime: null,
      reason: `No sandbox runtime found on ${platform} (checked: docker, podman).`,
      install,
      message: `Unattended factory runs require a container sandbox (Docker or Podman) to protect the host machine.\n${install}`,
    };
  }

  if (platform === "win32") {
    const wslBin = which("wsl.exe");
    if (wslBin) {
      return {
        ok: true,
        runtime: "wsl2",
        bin: wslBin,
        wrap: (cmd, { cwd = process.cwd() } = {}) => [
          wslBin,
          "--cd",
          winToWslPath(cwd),
          "--exec",
          "env",
          `AOS_SANDBOX_MARKER=${env.AOS_SANDBOX_MARKER || "1"}`,
          ...cmd,
        ],
      };
    }
    const dockerBin = which("docker") || which("docker.exe");
    if (dockerBin) {
      return {
        ok: true,
        runtime: "docker",
        bin: dockerBin,
        wrap: (cmd, { cwd = process.cwd() } = {}) => [
          dockerBin,
          "run",
          "-i",
          "--rm",
          "-v",
          `${cwd}:${cwd}`,
          "-w",
          cwd,
          "-e",
          `AOS_SANDBOX_MARKER=${env.AOS_SANDBOX_MARKER || "1"}`,
          env.AOS_SANDBOX_IMAGE || "node:24-bookworm",
          ...cmd,
        ],
      };
    }
    const install =
      "Install WSL2 (`wsl --install`) or Docker Desktop (https://www.docker.com/products/docker-desktop).";
    return {
      ok: false,
      runtime: null,
      reason: "No sandbox runtime found on Windows (checked: wsl2, docker).",
      install,
      message: `Unattended factory runs require a sandbox runtime (WSL2 or Docker Desktop) to protect the host machine on Windows.\n${install}`,
    };
  }

  return {
    ok: false,
    runtime: null,
    reason: `Unsupported platform "${platform}".`,
    install: "Unattended factory runs are supported on macOS, Linux, and Windows.",
    message: `Unsupported platform "${platform}". Unattended factory runs are supported on macOS, Linux, and Windows.`,
  };
}

export function runFactoryUnattended(cmd = [], {
  platform = process.platform,
  which = defaultWhich,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const sbx = resolveFactorySandbox({ platform, which, env });
  if (!sbx.ok) {
    const err = new Error(sbx.message);
    err.code = "NO_SANDBOX_RUNTIME";
    err.details = sbx;
    throw err;
  }
  return sbx.wrap(cmd, { cwd });
}
