#!/usr/bin/env node
// aos-factory --unattended: run a factory command inside a Docker/Podman container on a throwaway
// clone of the current branch. The host gate is untouched; only the container's own HOME gets the
// `off` gate profile. Results come back as a patch series and a git bundle, never as a push.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `usage: aos-factory --unattended --image <image> [--env NAME]... -- <command...>
  Runs <command> in a Docker/Podman container on a fresh clone of the current branch.
  --env NAME passes one host variable by name (e.g. the agent's API key); nothing else enters.`;

const INSTALL = {
  darwin: "install Docker Desktop (https://docs.docker.com/desktop/) or Podman (https://podman.io/docs/installation) and start it",
  linux: "install Docker Engine (https://docs.docker.com/engine/install/) or Podman (https://podman.io/docs/installation) and start the daemon",
  win32: "install Docker Desktop (https://docs.docker.com/desktop/setup/install/windows-install/) and start it",
};

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts });
const defaultWhich = (bin) => {
  const r = sh(process.platform === "win32" ? "where" : "which", [bin]);
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
};

// Docker everywhere; Podman on macOS/Linux. WSL2 alone shares the Windows drives (/mnt/c) and can
// start Windows programs (interop), so it is no sandbox.
export function detectRuntime({ platform = process.platform, which = defaultWhich, run = sh } = {}) {
  const hint = INSTALL[platform];
  if (!hint) return { ok: false, message: `unattended runs support macOS, Linux and Windows 10+, not ${platform}` };
  const candidates = platform === "win32" ? ["docker"] : ["docker", "podman"];
  const found = candidates.filter((c) => which(c));
  for (const rt of found) {
    if (run(rt, ["info"], { timeout: 20000 }).status === 0) return { ok: true, runtime: rt };
  }
  if (found.length) return { ok: false, message: `${found.join("/")} found but no daemon is reachable; start it (${hint})` };
  if (platform === "win32" && which("wsl.exe")) {
    return { ok: false, message: `WSL2 alone is not a sandbox (it mounts your Windows drives under /mnt and can start Windows programs); ${hint}` };
  }
  return { ok: false, message: `no container runtime found; ${hint}` };
}

// The clone mount is the only host path the container sees; refuse anything that could widen it.
export function checkRepoPath(repo, home = homedir()) {
  const r = resolve(repo), h = resolve(home);
  if (r === h || h.startsWith(r.endsWith(sep) ? r : r + sep)) throw new Error(`refused: repo ${r} is your home directory or one of its parents`);
  return r;
}

// --mount splits on commas and quotes; Docker Desktop on Windows takes C:/... sources.
export function mountSource(p, platform = process.platform) {
  if (/[,"\n\r]/.test(p)) throw new Error(`refused: path ${p} contains a character that breaks the container mount (comma, quote or newline)`);
  return platform === "win32" ? p.replace(/\\/g, "/") : p;
}

// Runs in the container before the command: the `off` profile goes into the container's own HOME,
// in the same file and format `aos-gate profile off` writes (max 2h, see lib/gate-profile.mjs).
const ENTRY = `set -e
node -e 'const fs=require("fs"),p=require("path"),d=p.join(require("os").homedir(),".aos/gate");fs.mkdirSync(d,{recursive:true,mode:0o700});const n=Date.now();fs.writeFileSync(p.join(d,"config.json"),JSON.stringify({version:1,profile:"off",set_at:new Date(n).toISOString(),expires_at:new Date(n+7200000).toISOString(),set_by:{uid:process.getuid?process.getuid():null,method:"aos-factory-sandbox"},grants:[]}),{mode:0o600})'
cd /work
exec "$@"`;

export function buildRunArgv({ runtime, clone, image, cmd, envNames = [], platform = process.platform }) {
  const argv = [runtime, "run", "--rm", "--entrypoint", "sh",
    "--mount", `type=bind,source=${mountSource(clone, platform)},target=/work`,
    "-w", "/work", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=/work"];
  for (const n of envNames) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new Error(`refused: bad --env name ${n}`);
    argv.push("-e", n);
  }
  argv.push(image, "-c", ENTRY, "aos-factory", ...cmd);
  return argv;
}

export function parseArgs(args) {
  const o = { unattended: false, image: null, envNames: [], cmd: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") { o.cmd = args.slice(i + 1); break; }
    if (a === "--unattended") o.unattended = true;
    else if (a === "--image") o.image = args[++i];
    else if (a === "--env") o.envNames.push(args[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

const git = (cwd, args, run = sh) => {
  const r = run("git", ["-c", `safe.directory=${cwd}`, "-C", cwd, ...args]);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout.trim();
};

export function main(args = process.argv.slice(2), {
  platform = process.platform, which = defaultWhich, run = sh, cwd = process.cwd(), home = homedir(),
  resultsRoot = join(homedir(), ".aos", "factory", "runs"), log = console.log, err = console.error,
} = {}) {
  let o;
  try { o = parseArgs(args); } catch (e) { err(`aos-factory: ${e.message}\n${USAGE}`); return 2; }
  if (!o.unattended) { err(`aos-factory: only --unattended is a CLI mode; interactive runs use /factory in a session.\n${USAGE}`); return 2; }
  if (!o.image || !o.cmd.length) { err(`aos-factory: --image and a command after -- are required.\n${USAGE}`); return 2; }

  const rt = detectRuntime({ platform, which, run });
  if (!rt.ok) { err(`aos-factory: unattended mode refused: ${rt.message}`); return 1; }

  let repo, branch, base;
  try {
    repo = checkRepoPath(git(cwd, ["rev-parse", "--show-toplevel"], run), home);
    branch = git(repo, ["symbolic-ref", "--short", "HEAD"], run);
    base = git(repo, ["rev-parse", "HEAD"], run);
    if (git(repo, ["status", "--porcelain"], run)) err("aos-factory: note: uncommitted changes stay on the host and are not part of the run");
  } catch (e) { err(`aos-factory: ${/symbolic-ref/.test(e.message) ? "detached HEAD: check out a branch first" : e.message}`); return 1; }

  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
  const tmp = mkdtempSync(join(tmpdir(), "aos-factory-"));
  const clone = join(tmp, "repo");
  let code = 1;
  try {
    // --no-local copies objects through the git transport: no hardlinks, no shared .git with the host.
    const c = run("git", ["clone", "--no-local", "--no-hardlinks", "--quiet", "--branch", branch, repo, clone]);
    if (c.status !== 0) throw new Error(`clone failed: ${(c.stderr || "").trim()}`);
    git(clone, ["remote", "remove", "origin"], run);
    git(clone, ["config", "user.name", "aos-factory"], run);
    git(clone, ["config", "user.email", "aos-factory@localhost.invalid"], run);
    // The image user may have another uid than the host user; the parent tmp dir stays 0700.
    if (platform !== "win32") run("chmod", ["-R", "a+rwX", clone]);

    const argv = buildRunArgv({ runtime: rt.runtime, clone, image: o.image, cmd: o.cmd, envNames: o.envNames, platform });
    log(`aos-factory: run ${id} in ${rt.runtime} (${o.image}) on a clone of ${branch} @ ${base.slice(0, 12)}`);
    const r = run(argv[0], argv.slice(1), { stdio: "inherit", encoding: undefined });
    code = r.status ?? 1;
    if (r.error) err(`aos-factory: ${r.error.message}`);

    const out = join(resultsRoot, id);
    mkdirSync(out, { recursive: true, mode: 0o700 });
    const head = git(clone, ["rev-parse", "HEAD"], run);
    const count = Number(git(clone, ["rev-list", "--count", `${base}..${head}`], run));
    writeFileSync(join(out, "run.json"), JSON.stringify({ id, repo, branch, base, head, commits: count, exit: code, runtime: rt.runtime, image: o.image }, null, 2) + "\n");
    if (count > 0) {
      git(clone, ["format-patch", "--quiet", "-o", join(out, "patches"), `${base}..${head}`], run);
      git(clone, ["bundle", "create", join(out, "run.bundle"), "HEAD", `^${base}`], run);
      log(`aos-factory: ${count} commit(s) exported to ${out}
  review: git fetch "${join(out, "run.bundle")}" HEAD:factory/${id} && git log -p ${base.slice(0, 12)}..factory/${id}
  or apply: git am "${join(out, "patches")}"/*.patch
  Nothing was pushed. Push, merge and publish stay on the host behind your GO.`);
    } else log(`aos-factory: no new commits; run record in ${out}`);
  } catch (e) {
    err(`aos-factory: ${e.message}`);
    code = code || 1;
  } finally {
    // Only ever our own mkdtemp dir under the OS temp root.
    if (basename(tmp).startsWith("aos-factory-") && resolve(tmp).startsWith(resolve(tmpdir()) + sep)) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { err(`aos-factory: could not remove ${tmp}; delete it by hand`); }
    }
  }
  if (code) err(`aos-factory: run ${id} failed (exit ${code})`);
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = main();
