import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRunArgv, checkRepoPath, detectRuntime, imageExists, main, mountSource, parseArgs, resolveBuildHint } from "../bin/aos-factory.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const whichOf = (...bins) => (b) => (bins.includes(b) ? `/fake/${b}` : null);
const infoOk = (cmd, args, opts) => (args[0] === "info" ? { status: 0 } : sh(cmd, args, opts));

test("refuses without a container runtime, with install hints", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const r = detectRuntime({ platform, which: whichOf(), run: () => ({ status: 1 }) });
    assert.equal(r.ok, false);
    assert.match(r.message, /install/i);
  }
  const errs = [];
  const code = main(["--unattended", "--image", "img", "--", "true"], { platform: "linux", which: whichOf(), err: (m) => errs.push(m), log: () => {} });
  assert.notEqual(code, 0);
  assert.match(errs.join("\n"), /refused/);
});

test("refuses when the runtime daemon is not reachable", () => {
  const r = detectRuntime({ platform: "linux", which: whichOf("docker"), run: () => ({ status: 1 }) });
  assert.equal(r.ok, false);
  assert.match(r.message, /daemon/);
});

test("refuses WSL2 alone on Windows and never offers Podman there", () => {
  const r = detectRuntime({ platform: "win32", which: whichOf("wsl.exe", "podman"), run: () => ({ status: 0 }) });
  assert.equal(r.ok, false);
  assert.match(r.message, /WSL2 alone is not a sandbox/);
  assert.deepEqual(detectRuntime({ platform: "win32", which: whichOf("docker", "wsl.exe"), run: () => ({ status: 0 }) }), { ok: true, runtime: "docker" });
  assert.deepEqual(detectRuntime({ platform: "linux", which: whichOf("podman"), run: () => ({ status: 0 }) }), { ok: true, runtime: "podman" });
});

test("refuses a repo that is HOME or an ancestor of it", () => {
  assert.throws(() => checkRepoPath("/home/u", "/home/u"), /refused/);
  assert.throws(() => checkRepoPath("/home", "/home/u"), /refused/);
  assert.throws(() => checkRepoPath("/", "/home/u"), /refused/);
  assert.equal(checkRepoPath("/home/u/dev/app", "/home/u"), "/home/u/dev/app");
  assert.equal(checkRepoPath("/home/user2", "/home/u"), "/home/user2");
});

test("argv mounts only the clone: no worktree, ssh, gitconfig, docker.sock or --privileged", () => {
  const worktree = "/home/u/dev/app";
  for (const runtime of ["docker", "podman"]) {
    const argv = buildRunArgv({ runtime, clone: "/tmp/aos-factory-x/repo", image: "img", cmd: ["claude", "-p", "/factory"], envNames: ["ANTHROPIC_API_KEY"], platform: "linux" });
    const s = argv.join("\n");
    assert.ok(!s.includes(worktree));
    for (const bad of [".ssh", ".gitconfig", "docker.sock", "--privileged", "/home/u", ".aos/gate/config.json:"]) assert.ok(!s.includes(bad), `${runtime} argv contains ${bad}`);
    assert.ok(!argv.includes("-v") && !argv.includes("--volume"));
    const mounts = argv.filter((a, i) => argv[i - 1] === "--mount");
    assert.deepEqual(mounts, ["type=bind,source=/tmp/aos-factory-x/repo,target=/work"]);
    assert.ok(argv.includes("--rm") && argv.includes("ALL") && argv.includes("no-new-privileges"));
    assert.deepEqual(argv.slice(-3), ["claude", "-p", "/factory"]);
  }
  assert.throws(() => buildRunArgv({ runtime: "docker", clone: "/tmp/x", image: "i", cmd: ["c"], envNames: ["A=B"] }), /bad --env/);
});

test("default image runs with --pull=never; an explicit other image does not", () => {
  const base = { runtime: "docker", clone: "/tmp/x", cmd: ["c"], platform: "linux" };
  assert.ok(buildRunArgv({ ...base, image: "aos-factory:local" }).includes("--pull=never"));
  assert.ok(!buildRunArgv({ ...base, image: "custom:1" }).includes("--pull=never"));
});

test("Windows paths convert for Docker; mount-breaking characters are refused", () => {
  assert.equal(mountSource("C:\\Users\\u\\AppData\\Local\\Temp\\aos-factory-1\\repo", "win32"), "C:/Users/u/AppData/Local/Temp/aos-factory-1/repo");
  for (const p of ["/tmp/a,b", "/tmp/a\"b", "C:\\a,b", "/tmp/a\nb"]) assert.throws(() => mountSource(p, "linux"), /refused/);
});

test("end to end with a fake runtime: clone only, commits exported, host repo untouched", () => {
  const base = mkdtempSync(join(tmpdir(), "factory-e2e-"));
  try {
    const repo = join(base, "app");
    const g = (...a) => assert.equal(sh("git", ["-C", repo, ...a]).status, 0, a.join(" "));
    assert.equal(sh("git", ["init", "-q", "-b", "main", repo]).status, 0);
    g("config", "user.email", "t@example.invalid"); g("config", "user.name", "t");
    writeFileSync(join(repo, "a.txt"), "a\n"); g("add", "."); g("commit", "-qm", "init");
    const before = sh("git", ["-C", repo, "rev-parse", "HEAD"]).stdout.trim();
    let runArgv = null;
    const run = (cmd, args, opts) => {
      if (cmd === "docker" && args[0] === "run") {
        runArgv = [cmd, ...args];
        const src = args[args.indexOf("--mount") + 1].match(/source=([^,]+)/)[1];
        assert.equal(sh("git", ["-C", src, "remote"]).stdout.trim(), "", "clone has no remotes");
        writeFileSync(join(src, "b.txt"), "b\n");
        assert.equal(sh("git", ["-C", src, "add", "."]).status, 0);
        assert.equal(sh("git", ["-C", src, "commit", "-qm", "feat: b"]).status, 0);
        return { status: 0 };
      }
      return infoOk(cmd, args, opts);
    };
    const results = join(base, "runs");
    const logs = [];
    const code = main(["--unattended", "--image", "img", "--", "true"], { platform: "linux", which: whichOf("docker"), run, cwd: repo, home: join(base, "home"), resultsRoot: results, log: (m) => logs.push(m), err: (m) => logs.push(m) });
    assert.equal(code, 0, logs.join("\n"));
    assert.ok(!runArgv.join(" ").includes(`source=${repo},`));
    assert.equal(sh("git", ["-C", repo, "rev-parse", "HEAD"]).stdout.trim(), before, "host branch unchanged");
    const [id] = readdirSync(results);
    const out = join(results, id);
    assert.equal(JSON.parse(readFileSync(join(out, "run.json"), "utf8")).commits, 1);
    assert.equal(readdirSync(join(out, "patches")).length, 1);
    assert.equal(sh("git", ["-C", repo, "fetch", "-q", join(out, "run.bundle"), `HEAD:factory/${id}`]).status, 0);
    assert.equal(sh("git", ["-C", repo, "log", "-1", "--format=%s", `factory/${id}`]).stdout.trim(), "feat: b");
    assert.match(logs.join("\n"), /git am/);
    assert.ok(!existsSync(dirname(runArgv[runArgv.indexOf("--mount") + 1].match(/source=([^,]+)/)[1])), "temp clone removed");

    const failRun = (cmd, args, opts) => (cmd === "docker" && args[0] === "run" ? { status: 3 } : infoOk(cmd, args, opts));
    assert.equal(main(["--unattended", "--image", "img", "--", "true"], { platform: "linux", which: whichOf("docker"), run: failRun, cwd: repo, home: join(base, "home"), resultsRoot: results, log: () => {}, err: () => {} }), 3);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the container entry writes a valid off profile into the container HOME only", { skip: process.platform === "win32" }, async () => {
  const { readProfile } = await import("../lib/gate-profile.mjs");
  const argv = buildRunArgv({ runtime: "docker", clone: "/tmp/x", image: "i", cmd: ["c"] });
  const script = argv[argv.indexOf("-c") + 1].split("\n").find((l) => l.startsWith("node -e "));
  const js = script.slice("node -e '".length, -1);
  const home = mkdtempSync(join(tmpdir(), "factory-home-"));
  try {
    assert.equal(sh(process.execPath, ["-e", js], { env: { ...process.env, HOME: home } }).status, 0);
    const p = readProfile({ file: join(home, ".aos", "gate", "config.json") });
    assert.equal(p.profile, "off", p.reason);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the host gate is unchanged against release/next-541", (t) => {
  if (sh("git", ["-C", ROOT, "rev-parse", "--verify", "-q", "release/next-541"]).status !== 0) return t.skip("release/next-541 not present");
  const r = sh("git", ["-C", ROOT, "diff", "--quiet", "release/next-541", "--", ".claude/hooks/go-gate.mjs", "bin/go-check.mjs"]);
  assert.equal(r.status, 0, "go-gate.mjs or go-check.mjs differs from release/next-541");
});

test("default image missing fails with the build hint; explicit --image skips the inspect", () => {
  const inspected = [];
  const run = (cmd, args, opts) => {
    if (args[0] === "info") return { status: 0 };
    if (args[0] === "image") { inspected.push(args[2]); return { status: 1 }; }
    return { status: 1, stdout: "", stderr: "" };
  };
  const errs = [];
  const code = main(["--unattended", "--", "true"], { platform: "linux", which: whichOf("docker"), run, cwd: ROOT, home: join(ROOT, "no-home"), resultsRoot: join(ROOT, "no-runs"), log: () => {}, err: (m) => errs.push(m) });
  assert.equal(code, 1);
  assert.match(errs.join("\n"), /docker build -t aos-factory:local -f .*docker\/factory\/Dockerfile/);
  assert.deepEqual(inspected, ["aos-factory:local"]);

  inspected.length = 0;
  main(["--unattended", "--image", "custom:1", "--", "true"], { platform: "linux", which: whichOf("docker"), run, cwd: ROOT, home: join(ROOT, "no-home"), resultsRoot: join(ROOT, "no-runs"), log: () => {}, err: () => {} });
  assert.deepEqual(inspected, []);
});

test("Dockerfile exists and validates against the spec", () => {
  const dockerfile = join(ROOT, "docker/factory/Dockerfile");
  assert.ok(existsSync(dockerfile), "Dockerfile exists at docker/factory/Dockerfile");
  const content = readFileSync(dockerfile, "utf8");
  assert.match(content, /FROM node:\d+-slim/, "Dockerfile uses node slim base image");
  assert.ok(content.includes("git"), "Dockerfile installs git");
  assert.ok(!/^COPY\s+\.\s/m.test(content), "Dockerfile does not COPY the whole build context");
  assert.ok(content.includes("--omit=dev"), "Dockerfile installs production dependencies only");
  assert.ok(!content.match(/ADD.*https?:\/\//), "Dockerfile does not ADD from remote URLs");
  assert.match(content, /USER\s+\w+/, "Dockerfile has a non-root USER directive");
  assert.ok(!/^USER\s+root/m.test(content), "Dockerfile USER is not root");
  assert.ok(content.includes("WORKDIR /work"), "Dockerfile sets WORKDIR /work");
});

test("resolveBuildHint returns correct build command", () => {
  const hint = resolveBuildHint("/path/to/aos");
  assert.match(hint, /docker build.*-t aos-factory:local.*-f.*docker\/factory\/Dockerfile/);
});

test("imageExists checks if image is available locally", () => {
  const run = (cmd, args) => {
    if (cmd === "docker" && args[0] === "image" && args[1] === "inspect") {
      return args[2] === "exists" ? { status: 0 } : { status: 1 };
    }
    return { status: 1 };
  };
  assert.ok(imageExists("exists", "docker", run), "imageExists returns true for existing image");
  assert.ok(!imageExists("missing", "docker", run), "imageExists returns false for missing image");
});
