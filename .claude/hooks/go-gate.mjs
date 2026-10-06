#!/usr/bin/env node
// PreToolUse gate for outward-facing / hard-to-reverse commands across harnesses:
// - Antigravity / Gemini CLI (hooks.json PreToolUse)
// - Claude Code (.claude/hooks/go-gate.mjs)
//
// Scope:
// 1. git push
// 2. npm publish
// 3. npm version
// 4. gh pr merge
// 5. gh release create
// 6. git reset --hard
// 7. git clean -f (force clean untracked files)
// 8. rm -r / rm -rf (recursive deletions)
// 9. git branch -D, git worktree remove, gh pr/issue/release/repo writes, gh api writes
// (GUARDED_PATTERNS is the authoritative list; each maps to a grant scope in classify; a catch-all covers what the parser cannot own.)
//
// Gate validity: open ONLY if the LAST user message in the transcript is
// human-typed (isHumanEntry) and is the literal word "GO" (case-insensitive,
// trimmed), or `GO <PR numbers>` (parseGoText). Any other message closes it.
//
// Token path (master-session): a `GO <session>` typed by the human in a master
// session is turned into ~/.aos/go/<session>.token by go-token.mjs. This gate
// honours that token once, if it is <10 min old, names this session, and the
// master transcript it points at still ends with that very `GO <session>`.
// Own session name: latest agent-name/custom-title entry in this transcript
// (what --name / ListAgents show), else env AOS_SESSION_NAME. If neither is
// available the token path stays closed.
//
// A token is single-use per master message: the master's GO entry uuid (Claude)
// or message id (OpenCode) goes into ~/.aos/go/.consumed, so a re-minted token
// on an unchanged master cannot be replayed.
//
// Threat model: this stops accidental or replayed GOs, not an agent that can
// write arbitrary files; it can forge a master transcript. Nothing in-process fixes that.
//
// OpenCode-issued tokens (issuer "opencode") are verified offline against
// opencode.db, read-only. Limits: the schema is internal and undocumented, only
// the default XDG / ~/.local/share data dir is read, and bun:sqlite is an
// unverified fallback. Any miss fails closed; the human types a literal GO.

//
// Modes and grants (typed `gogate ...`, or /bdb-aos:gogate; set only by go-grant.mjs):
// per session, state in ~/.aos/gate/<session-key>.json. `hard` = literal GO
// each time. `soft` (default) = hard plus active grants (scope + expiry) for
// matching commands. `off` = log only, this session only, 24 h at most. The
// store is a pointer list: every mode and grant is re-derived at use time from
// the human transcript entry it names (origin, text hash, timestamp), so a
// hand-written or widened grant fails closed to hard.
//
// Origin: only human-typed entries count, as GO and as gogate commands
// (isHumanEntry). Loops, peers, task notifications, SDK and system prompts never.

import { readFileSync, writeFileSync, existsSync, unlinkSync, realpathSync, mkdirSync, renameSync, appendFileSync, readdirSync, openSync, readSync, closeSync, fstatSync, statSync, lstatSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Command start: line/separator/subshell start, then optional wrappers (sudo/env/command/
// builtin/exec/nohup/time/xargs/eval with options, `bash -c`, VAR=x), an optional opening
// quote (bash -c 'git push') and an optional directory (/usr/bin/git). The regexes are the
// fast first line; the token classifier below (classify + the catch-all) is the authority.
const WRAP = String.raw`(?:(?:sudo|env|command|builtin|exec|nohup|time|xargs|eval|then|do|else|until|while|if|elif)(?:\s+-{1,2}[\w-]+(?:=\S*)?(?:\s+(?![-'"])(?!(?:\S*/)?(?:git|gh|npm|rm|opencode|curl|wget)\b)[^\s;&|'"]+)?)*\s+|(?:bash|sh|zsh|dash|ksh)(?:\s+-\w+)*\s+-c\s+|\w+=\S*\s+)*`;
const A = String.raw`(?:^|[;&|\n({\x60])\s*${WRAP}['"]?(?:[^\s;&|()'"]{0,128}/)?`;
// git / gh with global options before the subcommand (plain `git <sub>` is spelled out too).
const G = String.raw`git(?:\s+(?:-[cC]\s*(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?))+\s+`;
const GH = String.raw`gh(?:\s+(?:-R|--repo)(?:\s+|=)\S+)+\s+`;
const S = String.raw`[^;&|\n]*`;
const re = (s, f = "i") => new RegExp(A + s, f);

export const GUARDED_PATTERNS = [
  re(String.raw`(?:git\s+push|${G}push)\b`),
  re(String.raw`npm\s+publish\b`),
  re(String.raw`npm\s+version\b`),
  re(String.raw`(?:gh\s+pr\s+merge|${GH}pr\s+merge)\b`),
  re(String.raw`(?:gh\s+release\s+create|${GH}release\s+create)\b`),
  re(String.raw`(?:git\s+reset\s+--hard|(?:git\s+|${G})reset\b${S}\s--hard)\b`),
  re(String.raw`(?:git\s+clean|${G}clean)\b${S}\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b`),
  re(String.raw`rm\s+(?:${S}\s)?['"]?(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b`),
  // case-sensitive: -d (safe delete) must stay unguarded, -D not
  re(String.raw`(?:git\s+branch|${G}branch)\b${S}\s(?:-[a-zA-Z]*D[a-zA-Z]*|-[a-zA-Z]*(?:df|fd)[a-zA-Z]*)(?=\s|$)`, ""),
  re(String.raw`(?:git\s+branch|${G}branch)\b(?=${S}\s(?:-d|--delete)\b)(?=${S}\s(?:-f|--force)\b)`, ""),
  re(String.raw`(?:git\s+worktree|${G}worktree)\s+remove\b`),
  re(String.raw`(?:gh\s+|${GH})pr\s+(?:create|comment|edit|review|close)\b`),
  re(String.raw`(?:gh\s+|${GH})issue\s+(?:create|comment)\b`),
  re(String.raw`(?:gh\s+|${GH})release\s+(?:edit|delete)\b`),
  re(String.raw`(?:gh\s+|${GH})repo\s+(?:create|edit|delete)\b`),
  re(String.raw`(?:gh\s+|${GH})api\b${S}\s(?:-X\s*|--method[\s=]+)(?:POST|PATCH|PUT|DELETE)\b`),
  re(String.raw`(?:gh\s+|${GH})api\b${S}\s(?:-[fF]|--field|--raw-field|--input)`, ""),
  // `git -c alias.x=push x`: a one-off alias hides the subcommand (a persisted `git config alias` cannot be seen here).
  re(String.raw`git\s+(?:-[cC]\s*\S+\s+)*-c\s*['"]?alias\.`),
  // Never grantable (no scope), always a plain GO: driving another OpenCode session
  // (resume/attach, or the server's HTTP API) can type text that looks human there.
  // The HTTP paths are matched anywhere in the command, independent of host spelling
  // (127.1, [::ffff:...], $(hostname), unix socket, fetch() inside node -e).
  // Residual risk: keystrokes into a resumed TUI (tmux send-keys, osascript) look exactly
  // like a human typing and cannot be told apart by any hook.
  re(String.raw`opencode\s+run\b${S}\s(?:-[a-zA-Z]*[sc]\S*|--session|--continue)(?=[\s=]|$)`, ""),
  re(String.raw`claude\b${S}\s(?:-[a-zA-Z]*[cr]\S*|--resume|--continue)(?=[\s=]|$)`, ""),
  re(String.raw`opencode\s+attach\b`),
  /\/session\/[^\s/'"]+\/(?:message|prompt_async|command|shell)\b/i,
  /\/\/[^\s'"]*\/tui\/|\/tui\/(?:append|submit|clear|execute|open|show|publish|control)/i,
];

// The two OpenCode HTTP-API patterns also apply to interpreter code (fetch() inside node).
export const HTTP_PATTERNS = GUARDED_PATTERNS.slice(-2);

// ---------------------------------------------------------------------------
// Scopes: each guarded command segment maps to the grant scope(s) it needs.
// ---------------------------------------------------------------------------
export const SCOPES = ["push-feature", "push-main", "merge", "publish", "destructive", "github-write"];

// Output redirections (`2>&1`, `>/dev/null`, `&>log`) are removed before splitting, so the
// `&` in `2>&1` is not a separator and `git push origin a:a 2>&1` reads as a plain push.
// Process substitutions `>(`/`<(` are kept (the `(` splits them into their own segment).
const REDIR = /\d*>&\d+|&>>?\s*[^\s(;&|]+|\d*>>?\s*[^\s(;&|]+/g;
const segments = (cmd) => commandView(cmd).text.replace(REDIR, " ").split(/&&|\|\||\$\(|[;&|\n(){}\x60]/).map((s) => s.trim()).filter(Boolean);
// Tokens keep quoted parts glued to their word; unq() gives the shell value (quotes and
// backslashes removed: `g\it`, `'git'`, `"push"` are git and push to the shell too).
const tokens = (s) => s.match(/(?:"[^"]*"|'[^']*'|[^\s"']+)+/g) || [];
const unq = (t) => String(t ?? "").replace(/["'\\]/g, "");
const base = (t) => unq(t).replace(/^.*\//, "");

// Transparent prefixes: the command after them is what runs. `v` = options taking a value,
// `pos` = positional arguments of the wrapper itself (timeout DURATION, script FILE).
const WRAPPERS = {
  sudo: { v: /^-[ugCDhpRrTUt]$/ }, doas: { v: /^-[uC]$/ }, env: { v: /^-[uCS]$/ }, command: {}, builtin: {}, exec: { v: /^-a$/ },
  nohup: {}, time: {}, nice: { v: /^-n$/ }, timeout: { v: /^-[sk]$/, pos: 1 }, caffeinate: { v: /^-[tw]$/ }, stdbuf: { v: /^-[ioe]$/ },
  // Loop and condition keywords run the command after them (aos-22: `until npm view ...; do ...; done`).
  xargs: { v: /^-[IPndLsEa]$/ }, script: { v: /^-[Ft]$/, pos: 1 }, then: {}, do: {}, else: {}, until: {}, while: {}, if: {}, elif: {},
};
const SHELLS = /^(?:bash|sh|zsh|dash|ksh|eval|watch|parallel)$/;

// Strips `!`, VAR=x and wrappers. `opaque`: the real command text is hidden (sh -c, eval,
// watch, env -S, linux `script -c`, xargs input); `gitEnv`: a GIT_* variable is set.
function stripPrefix(tok) {
  let i = 0, opaque = false, gitEnv = false;
  for (;;) {
    const t = unq(tok[i] ?? "");
    if (t === "!") { i++; continue; }
    if (/^\w+=/.test(t)) { gitEnv ||= /^(?:GIT_|HOME=|XDG_CONFIG_HOME=)/.test(t); i++; continue; }
    const w = WRAPPERS[base(tok[i] ?? "")];
    if (!w) break;
    const name = base(tok[i]);
    i++;
    let pos = w.pos || 0;
    while (i < tok.length) {
      const o = unq(tok[i]);
      if (name === "env" && /^\w+=/.test(o)) { gitEnv ||= /^(?:GIT_|HOME=|XDG_CONFIG_HOME=)/.test(o); i++; continue; }
      if (o.startsWith("-") && o !== "-") {
        if ((name === "env" && /^-S/.test(o)) || (name === "script" && o === "-c")) opaque = true;
        i += w.v?.test(o) ? 2 : 1;
        continue;
      }
      if (pos > 0) { pos--; i++; continue; }
      break;
    }
    if (name === "xargs") opaque = true;
  }
  const head = base(tok[i] ?? "");
  if (SHELLS.test(head)) opaque = true;
  return { rest: tok.slice(i), opaque, gitEnv };
}

// Branches a push-feature grant never covers. Default: main/master plus the usual long-lived
// names; at gate time the remote's HEAD (git symbolic-ref) replaces the long list when it
// resolves. AOS_GATE_PROTECTED_BRANCHES adds a comma list. `release-*` style globs allowed.
export const FALLBACK_PROTECTED = ["main", "master", "develop", "trunk", "production", "release", "release-*", "release/*"];
const envProtected = () => String(process.env.AOS_GATE_PROTECTED_BRANCHES || "").split(",").map((s) => s.trim()).filter(Boolean);
const isProtected = (branch, list) => list.some((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(branch));

// Injectable resolver: (remote) => string[] of protected branch names. Never throws; any
// failure falls back to FALLBACK_PROTECTED, so an unresolvable remote is protected widely.
export function makeBranchResolver(cwd, run) {
  const cache = new Map();
  return (remote) => {
    if (cache.has(remote)) return cache.get(remote);
    let list = [...FALLBACK_PROTECTED];
    try {
      if (/^[A-Za-z0-9._-]+$/.test(remote) && run) {
        const r = run("git", ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`], { cwd, encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
        const head = r && r.status === 0 ? String(r.stdout).trim().replace(new RegExp(`^${remote}/`), "") : "";
        if (/^[A-Za-z0-9._/-]+$/.test(head)) list.push(head);
      }
    } catch { /* fall back */ }
    list.push(...envProtected());
    cache.set(remote, list);
    return list;
  };
}
const staticResolver = () => [...FALLBACK_PROTECTED, ...envProtected()];

const SAFE_NAME = /^[A-Za-z0-9._/-]+$/;
const SAFE_PUSH_OPT = /^(?:-u|--set-upstream|-q|--quiet|-v|--verbose|--no-verify|-n|--dry-run|--progress|--no-progress|--porcelain|--atomic|--no-atomic|--signed|--no-signed)$/;

// push-feature is an allowlist: every token plain, every refspec EXPLICIT `src:dst` (an
// explicit destination is never remapped by remote.<name>.push or push.default), the
// destination not protected. Anything it cannot read (quotes, $, globs, @, +, refs/ outside
// heads/tags, config overrides, stdin-fed xargs, no `:dst`) needs push-main.
// Current branch of the repository containing `dir`, read from HEAD without spawning git.
// Handles a .git directory and a linked worktree (.git file -> gitdir). null = unknown or a
// detached HEAD, which callers treat as the protected case.
let segCwd = "";
// { gitdir, common } of the repository containing `dir` (a .git directory, or a linked
// worktree's .git file -> gitdir -> commondir), found without spawning git. null = none.
function locateGit(dir) {
  try {
    let d = resolve(dir);
    for (let k = 0; k < 64; k++) {
      let gitdir = null;
      try {
        const g = join(d, ".git"), st = statSync(g);
        if (st.isDirectory()) gitdir = g;
        else if (st.isFile() && st.size < 4096) {
          const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(g, "utf8"));
          if (m) gitdir = resolve(d, m[1].trim());
        }
      } catch { /* no .git here */ }
      if (gitdir) {
        let common = gitdir;
        try { common = resolve(gitdir, readFileSync(join(gitdir, "commondir"), "utf8").trim()); } catch { /* not a linked worktree */ }
        return { gitdir, common };
      }
      const up = resolve(d, "..");
      if (up === d) return null;
      d = up;
    }
  } catch { /* unreadable: unknown */ }
  return null;
}

// Current branch, read from HEAD. null = unknown or a detached HEAD (callers treat both as protected).
export function currentBranch(dir) {
  const loc = locateGit(dir);
  if (!loc) return null;
  try {
    const f = join(loc.gitdir, "HEAD");
    const head = statSync(f).size < 4096 ? readFileSync(f, "utf8").trim() : "";
    const b = /^ref:\s*refs\/heads\/(\S+)$/.exec(head)?.[1];
    return b && SAFE_NAME.test(b) ? b : null;
  } catch { return null; }
}

// Minimal git config reader: system, XDG, ~/.gitconfig (the OS user's real home, injectable via
// setGateContext({realHome})), the repo's config (the common dir for a linked worktree) and
// config.worktree when extensions.worktreeConfig is on. Any include/includeIf, unreadable or
// oversized file, or a GIT_* variable that redirects git makes it null: callers then fail closed.
const GIT_REDIRECT = /^(?:GIT_DIR|GIT_COMMON_DIR|GIT_WORK_TREE|GIT_CONFIG\w*|GIT_INDEX_FILE|GIT_NAMESPACE)$/;
function parseGitConfig(text, out) {
  let section = "", sub = null;
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line[0] === "#" || line[0] === ";") continue;
    const h = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/.exec(line);
    if (h) {
      section = h[1].toLowerCase();
      sub = h[2] ?? null;
      if (/^include(?:if)?(?:\.|$)/.test(section)) return false;
      if (sub === null && section.includes(".")) { const i = section.indexOf("."); sub = h[1].slice(i + 1); section = section.slice(0, i); }
      line = h[3].trim();
      if (!line || /^[#;]/.test(line)) continue;
    }
    const m = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
    if (!m) continue;
    const v = m[2] === undefined ? "true" : m[2].replace(/\s+[#;].*$/, "").trim().replace(/^"(.*)"$/, "$1");
    out.push({ s: section, sub, k: m[1].toLowerCase(), v });
  }
  return true;
}
export function gitConfig(repoDir) {
  if (Object.keys(process.env).some((k) => GIT_REDIRECT.test(k))) return null;
  const loc = locateGit(repoDir);
  if (!loc) return null;
  const rh = gateCtx.realHome ?? osHome();
  const out = [];
  const readOne = (f) => {
    let text;
    try {
      if (statSync(f).size > 256 * 1024) return false;
      text = readFileSync(f, "utf8");
    } catch (e) { return e?.code === "ENOENT" || e?.code === "ENOTDIR"; }
    return parseGitConfig(text, out);
  };
  for (const f of ["/etc/gitconfig", join(process.env.XDG_CONFIG_HOME || join(rh, ".config"), "git", "config"), join(rh, ".gitconfig"), join(loc.common, "config")]) if (!readOne(f)) return null;
  const last = (s, sub, k) => out.filter((e) => e.s === s && e.sub === sub && e.k === k).at(-1)?.v;
  if (/^(?:true|yes|on|1)$/i.test(last("extensions", null, "worktreeconfig") ?? "") && !readOne(join(loc.gitdir, "config.worktree"))) return null;
  return {
    get: (s, sub, k) => last(s, sub ?? null, k),
    all: (s, sub, k) => out.filter((e) => e.s === s && e.sub === (sub ?? null) && e.k === k).map((e) => e.v),
  };
}
const isTrue = (v) => /^(?:true|yes|on|1)$/i.test(v ?? "");

// A plain branch name (`git push origin fix/x`) and a bare push (`git push [-u] [remote]`) are
// push-feature only when the config files PROVE the destination is an unprotected branch:
// no remote.<name>.push refmap (or mirror) for any remote involved, and for a bare push the
// current branch plus push.default (simple/current: the branch's own name, and for simple a
// branch.<cur>.merge that is unset or equal; upstream/tracking: branch.<cur>.merge). Everything
// else (matching, nothing, includes, -c, GIT_*, detached HEAD, unknown branch) is push-main.
function pushScopes(args, unsafe, protectedFor, repo = null) {
  let main = unsafe, publish = false;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === "--tags" || t === "--follow-tags") publish = true;
    else if (t === "-o" || t === "--push-option") i++;
    else if (/^--push-option=/.test(t)) continue;
    else if (t.startsWith("-")) { if (!SAFE_PUSH_OPT.test(t)) main = true; }
    else pos.push(t);
  }
  const [remote, ...refs] = pos;
  if (remote && !SAFE_NAME.test(remote)) main = true;
  const prot = protectedFor(remote || "");
  const cfg = repo?.cfg ?? null, branch = repo?.branch ?? null;
  const refmap = (name) => !!cfg && !!name && (cfg.all("remote", name, "push").length > 0 || isTrue(cfg.get("remote", name, "mirror")));
  const badBranch = (b) => !b || b.startsWith("-") || b.startsWith(".") || /^head$/i.test(b) || isProtected(b, prot);
  if (cfg && isTrue(cfg.get("push", null, "followtags"))) publish = true;
  if (!refs.length) {
    // bare push: the remote and the destination both come from the config
    if (!cfg || !branch) main = true;
    else {
      const named = [remote, cfg.get("branch", branch, "pushremote"), cfg.get("remote", null, "pushdefault"), cfg.get("branch", branch, "remote")].filter(Boolean);
      if ([...named, named[0] ?? "origin"].some(refmap)) main = true; // no remote named anywhere: git pushes to origin
      if (named[0] && /^\./.test(named[0])) main = true;
      const mode = (cfg.get("push", null, "default") ?? "simple").toLowerCase();
      const merge = cfg.get("branch", branch, "merge");
      let dst = null;
      if (mode === "current") dst = branch;
      else if (mode === "simple") dst = merge === undefined || merge === `refs/heads/${branch}` ? branch : null;
      else if (mode === "upstream" || mode === "tracking") dst = /^refs\/heads\//.test(merge ?? "") ? merge.slice(11) : null;
      if (badBranch(dst)) main = true;
    }
  }
  for (const r0 of refs) {
    // `fix/x` on the command line means `fix/x:fix/x` unless a push refmap exists for the remote;
    // HEAD, @ and refs/... stay unreadable.
    const plain = !r0.includes(":") && /^[A-Za-z0-9._/-]+$/.test(r0) && !/^refs\//.test(r0);
    if (plain && (!cfg || !remote || refmap(remote))) { main = true; continue; }
    const r = plain ? `${r0}:${r0}` : r0;
    const m = /^([A-Za-z0-9._/-]+):([A-Za-z0-9._/-]+)$/.exec(r);
    if (/^(?:refs\/tags\/|v?\d+(?:\.\d+)+)/.test(r.split(":").pop())) { publish = true; continue; }
    if (!m) { main = true; continue; } // no explicit destination
    const d = m[2].replace(/^(?:refs\/)?heads\//, "");
    if (/^refs\/tags\//.test(m[1])) { publish = true; continue; }
    if (/^head$/i.test(d) || d.startsWith("refs/") || d.startsWith("-") || d.startsWith(".") || isProtected(d, prot)) main = true;
  }
  const out = [];
  if (publish) out.push("publish");
  if (main) out.push("push-main");
  return out.length ? out : ["push-feature"];
}

function ghParts(tok) {
  let i = 1;
  for (;;) {
    const t = unq(tok[i] ?? "");
    if (/^(?:-R|--repo)$/.test(t)) i += 2;
    else if (/^--repo=/.test(t)) i++;
    else break;
  }
  return { a: unq(tok[i]), b: unq(tok[i + 1]), rest: tok.slice(i + 2).map(unq) };
}

const GIT_VALUE_OPTS = /^(?:-[cC]|--git-dir|--work-tree|--namespace|--super-prefix|--exec-path|--config-env|--list-cmds|--attr-source)$/;
const GIT_FLAG_OPTS = /^(?:-[pP]|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--no-lazy-fetch|--no-advice|--html-path|--man-path|--info-path|--version|--help)$/;
const PUSHY_CONFIG = /push|remote\.|url\.|insteadof|alias\./i;
const PM = /^(?:npm|pnpm|yarn|bun)$/;
const NPM_VALUE_OPTS = /^(?:--prefix|-w|--workspace|-C|--dir|--registry|--userconfig|--cache|--tag|--otp|--access|--filter|--cwd)$/;

// Precise classification of one segment: array of scopes, [] = not guarded,
// null = guarded but not classifiable (never grantable).
export function classify(seg, protectedFor = staticResolver) {
  const { rest: tok, opaque, gitEnv } = stripPrefix(tokens(seg));
  const cmd = base(tok[0] ?? "");
  if (opaque) {
    if (!catchAll(tok, seg, true)) return [];
    // `bash -c 'rm -rf build'` is understood: a destructive-only inner command is grantable.
    const inner = commandScopes(innerText(tok), protectedFor);
    return inner?.length && inner.every((x) => x === "destructive") ? ["destructive"] : null;
  }
  if (cmd === "git" || cmd === "hub") {
    let i = 1, config = false, repoDir = segCwd || gateCtx.cwd || process.cwd();
    for (;;) {
      const t = unq(tok[i] ?? "");
      if (GIT_VALUE_OPTS.test(t)) {
        config ||= /^(?:-c|--config-env)$/.test(t);
        if (t === "-C") repoDir = resolve(expandHome(repoDir), expandHome(unq(tok[i + 1] ?? "")));
        else if (/^--(?:git-dir|work-tree)$/.test(t)) repoDir = null;
        i += 2;
      }
      else if (/^(?:-[cC].|--[\w-]+=)/.test(t)) {
        config ||= /^(?:-c.|--config-env=)/.test(t);
        if (/^-C./.test(t)) repoDir = resolve(expandHome(repoDir), expandHome(t.slice(2)));
        else if (/^--(?:git-dir|work-tree)=/.test(t)) repoDir = null;
        i++;
      }
      else if (GIT_FLAG_OPTS.test(t)) i++;
      else if (t.startsWith("-")) return catchAll(tok, seg) ? null : []; // unknown global option
      else break;
    }
    const sub = unq(tok[i]), r = tok.slice(i + 1).map(unq);
    if (sub === "push") {
      const unsafe = config || gitEnv || /[<'"$\x60\\*?{}[\]~^]/.test(tok.slice(i).join(" "));
      return pushScopes(r, unsafe, protectedFor, repoDir ? { branch: currentBranch(repoDir), cfg: gitConfig(repoDir) } : null);
    }
    if (sub === "reset" && r.includes("--hard")) return ["destructive"];
    if (sub === "clean" && r.some((t) => /^-[a-zA-Z]*f/.test(t) || t === "--force")) return ["destructive"];
    if (sub === "branch") {
      const del = r.some((t) => /^-[a-zA-Z]*D/.test(t) || /^-[a-zA-Z]*(?:df|fd)/.test(t)) ||
        (r.some((t) => t === "--delete" || /^-[a-ce-zA-Z]*d[a-zA-Z]*$/.test(t)) && r.some((t) => t === "--force" || /^-[a-eg-zA-Z]*f[a-zA-Z]*$/.test(t)));
      return del ? ["destructive"] : [];
    }
    if (sub === "worktree" && r[0] === "remove") return ["destructive"];
    if (sub === "config" && r.some((t) => PUSHY_CONFIG.test(t))) {
      const args = r.filter((t) => !t.startsWith("-"));
      const read = r.some((t) => /^(?:--get\S*|--list|-l)$/.test(t)) || (args.length === 1 && !r.some((t) => /^--(?:add|unset\S*|replace-all|edit|rename-section|remove-section)$|^-e$/.test(t)));
      return read ? [] : null;
    }
    return [];
  }
  if (PM.test(cmd) || cmd === "npx") {
    if (cmd === "npx") return catchAll(tok, seg) ? null : [];
    let i = 1;
    while (unq(tok[i] ?? "").startsWith("-")) i += NPM_VALUE_OPTS.test(unq(tok[i])) ? 2 : 1;
    const sub = unq(tok[i]), next = unq(tok[i + 1]);
    if (/^(?:publish|version)$/.test(sub) || (cmd === "yarn" && sub === "npm" && next === "publish")) return ["publish"];
    return /^(?:run|run-script|exec|x|dlx)$/.test(sub) && catchAll(tok, seg) ? null : [];
  }
  if (cmd === "rm") {
    const r = tok.slice(1).map(unq);
    const end = r.indexOf("--");
    return r.slice(0, end === -1 ? undefined : end).some((t) => /^-[a-zA-Z]*[rR]/.test(t) || t === "--recursive") ? ["destructive"] : [];
  }
  if (cmd === "gh") {
    const { a, b, rest } = ghParts(tok);
    if (a === "pr" && b === "merge") return ["merge"];
    if (a === "pr" && /^(?:create|comment|edit|review|close)$/.test(b)) return ["github-write"];
    if (a === "release" && b === "create") return ["publish"];
    if (a === "release" && /^(?:edit|delete)$/.test(b)) return ["github-write"];
    if (a === "issue" && /^(?:create|comment)$/.test(b)) return ["github-write"];
    if (a === "repo" && /^(?:create|edit|delete)$/.test(b)) return ["github-write"];
    if (a === "api") {
      const s = [b, ...rest].join(" ");
      if (b === "graphql" && !/mutation/i.test(s) && !/(?:-X|--method)/i.test(s)) return [];
      if (/(?:^|\s)(?:-X\s*|--method[\s=]+)(?:POST|PATCH|PUT|DELETE)\b/i.test(s) || /(?:^|\s)(?:-[fF]|--field|--raw-field|--input)/.test(s)) return ["github-write"];
    }
    return [];
  }
  if (/^(?:push|publish)$/.test(tok[0] ?? "")) return null; // the program name was computed: `$(echo git) push`
  return catchAll(tok, seg) ? null : [];
}

// Catch-all for segments the precise parser does not own (unknown wrappers, `watch`, `sh -c`,
// unknown git options): a word whose basename is git followed later by a guarded git verb,
// a package manager followed later by publish/version, gh followed by a write verb, or rm
// with a recursive flag makes the segment guarded with no scope.
const GIT_VERBS = /^(?:push|reset|clean|branch|worktree|config)$/;
function catchAll(tok, seg, opaque = false) {
  // inside sh -c / eval / watch the quoted text is the command, so split it into words
  const w = (opaque ? tok.flatMap((t) => unq(t).split(/\s+/)) : tok).map(base);
  const after = (i, set) => w.slice(i + 1).some((x) => set.test(x));
  for (let i = 0; i < w.length; i++) {
    if ((w[i] === "git" || w[i] === "hub") && after(i, GIT_VERBS)) return true;
    // `npm view|info|show|v <pkg> version` only reads: its subcommand is not publish/version.
    const sub = w.slice(i + 1).find((x) => !x.startsWith("-"));
    if ((PM.test(w[i]) || w[i] === "npx") && !/^(?:view|info|show|v)$/.test(sub ?? "") && after(i, /^(?:publish|version)$/)) return true;
    if (w[i] === "gh" && after(i, /^(?:merge|create|delete|edit|comment|close|review|api)$/)) return true;
    if (/^(?:np|release-it|semantic-release)$/.test(w[i]) || (w[i] === "changeset" && after(i, /^publish$/))) return true;
    if (w[i] === "rm" && w.slice(i + 1).some((x) => /^-[a-zA-Z]*[rR]/.test(x) || x === "--recursive")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Delete analysis. One pass over a command yields { destructive, hard }:
// - destructive: a recursive delete in any language (rm -r, find -delete, rmSync/rmtree/
//   rm_rf/remove_tree/Remove-Item -Recurse/rd /s ...). Guarded, grantable scope `destructive`.
// - hard: the first delete target that is `/`, a bare `*`, the home directory or a direct
//   child of it. Never liftable (see hardBlockReason); recursive or not.
// Text that is data is removed first (commandView): heredoc bodies and the quoted arguments
// of grep/echo/jq/...; code that is executed (bash -c, node -e, python -c, eval, xargs,
// interpreter heredocs) is analysed recursively. Known gaps: paths built in variables
// (`H=$HOME; rm -rf $H`), code read from files, interpreters not listed in INTERP.
// ---------------------------------------------------------------------------
const SHELLISH = /(?:^|[\s;&|(])(?:sudo\s+)?(?:bash|sh|zsh|dash|ksh|fish|source|node|nodejs|bun|deno|python[\d.]*|ruby|perl|php|pwsh|powershell|lua|osascript|xargs|eval|ssh)(?=\s|$)/;
const INTERP = /^(?:node(?:js)?|bun|deno|python[\d.]*|ruby|perl|php|pwsh|powershell|cmd(?:\.exe)?|lua|osascript)$/i;
const DATA_HEAD = /^(?:echo|printf|grep|egrep|fgrep|rg|ag|jq|awk|gawk|sed)$/;
const unqQ = (t) => String(t ?? "").replace(/["']/g, "");

// A command longer than this is not analysed at all: it is guarded without a scope (a GO
// lifts it, a grant or mode does not), so no parser input can make the hook slow.
export const MAX_COMMAND = 16 * 1024;
export const TOO_LONG_MESSAGE = "command too long for the gate; split it or ask for GO";
export const commandTooLong = (c) => typeof c === "string" && c.length > MAX_COMMAND;

// Like tokens(), but $(...) and `...` stay inside one word, so a delete target such as
// $(echo ~) is seen whole.
function words(s) {
  const out = [];
  let cur = "", q = "", sub = 0, bt = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "\\" && q === '"') cur += s[++i] ?? ""; else if (c === q) q = ""; continue; }
    if (c === "\\") { cur += c + (s[++i] ?? ""); continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "`") { bt = !bt; cur += c; continue; }
    if (c === "$" && s[i + 1] === "(") { sub++; cur += "$("; i++; continue; }
    if (sub && c === ")") { sub--; cur += c; continue; }
    if (/\s/.test(c) && !sub && !bt) { if (cur) out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// Splits on unquoted ; & | newline ( ) and brace-group braces; quotes, ${...}, $(...) and `...` stay whole.
function scanSplit(cmd) {
  const s = String(cmd), out = [];
  let cur = "", q = "", depth = 0, sub = 0, bt = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === "\\" && q === '"') cur += s[++i] ?? ""; else if (c === q) q = ""; continue; }
    if (c === "\\") { cur += c + (s[++i] ?? ""); continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "`") { bt = !bt; cur += c; continue; }
    if (bt) { cur += c; continue; }
    if (c === "$" && s[i + 1] === "{") { depth++; cur += "${"; i++; continue; }
    if (depth && c === "}") { depth--; cur += c; continue; }
    if (sub) { if (c === "(") sub++; else if (c === ")") sub--; cur += c; continue; }
    if (c === "$" && s[i + 1] === "(") { sub++; cur += "$("; i++; continue; }
    if (";&|\n()".includes(c) || (c === "{" && /\s/.test(s[i + 1] ?? " ")) || (c === "}" && /[\s;]/.test(s[i - 1] ?? ";"))) { out.push({ t: cur, sep: c }); cur = ""; continue; }
    cur += c;
  }
  out.push({ t: cur, sep: "" });
  return out;
}
const topSegments = (cmd) => scanSplit(cmd).map((p) => p.t.trim()).filter(Boolean);

// Heredoc bodies are data, unless the line feeds an interpreter (kept, and returned in `code`).
// Unquoted heredocs still expand $(...) and backticks, so those stay visible.
// Fed to a shell the body is commands (kept in the text); fed to an interpreter it is code,
// returned in `code` with its language and inspected only at execution points (codeInto).
const HEREDOC_LANG = /(?:^|[\s;&|(])(?:sudo\s+)?(node|nodejs|bun|deno|python[\d.]*|ruby|perl|php|lua|osascript)(?=\s|$)/;
function stripHeredocs(cmd) {
  const out = [], code = [];
  let end = null, keep = false, expand = false, buf = [], lang = "";
  const close = () => {
    if (keep && lang) code.push({ body: buf.join("\n"), lang });
    else if (keep) out.push(...buf);
    else if (expand) for (const m of buf.join("\n").matchAll(/\$\([^)]*\)|(?<!\\)`[^`]*`/g)) out.push(m[0]);
    end = null; buf = [];
  };
  for (const line of String(cmd).split("\n")) {
    if (end !== null) { if (line.trim() === end) close(); else buf.push(line); continue; }
    out.push(line);
    const m = /(?<!<)<<(?!<)-?[ \t]*(?:'([^']+)'|"([^"]+)"|(\\?)([A-Za-z_]\w*))/.exec(line);
    if (m) { end = m[1] ?? m[2] ?? m[4]; keep = SHELLISH.test(line); lang = HEREDOC_LANG.exec(line)?.[1] ?? ""; expand = m[1] === undefined && m[2] === undefined && !m[3]; }
  }
  if (end !== null) close();
  return { text: out.join("\n"), code };
}

function blankQuotes(s) {
  return s.replace(/"((?:[^"\\]|\\.)*)"|'[^']*'/g, (q, dq) =>
    '""' + (dq ? [...dq.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)].map((m) => ` ; ${m[1] ?? m[2]}`).join("") : ""));
}
const FEEDS = /^(?:bash|sh|zsh|dash|ksh|fish|xargs|eval|source|\.|parallel|node|nodejs|bun|deno|python[\d.]*|ruby|perl|pwsh|powershell)$/;
// awk and sed programs can run commands (system(), getline, `| "cmd"`, sed's `e` command and
// `s///e`); such a program is never blanked as data.
const AWK_EXEC = /system\s*\(|getline|close\s*\(|\|\s*["'$]|\bprint[^;}]*\|\s*\S/;
const SED_EXEC = /(?<![A-Za-z_\\])e(?![A-Za-z_])|\/[gimIM0-9]*e[gimIM0-9]*\s*(?:["';}]|$)/;
// Does any LATER stage of the pipeline starting at piece k run a shell or interpreter?
function pipeFeeds(pieces, k) {
  if (pieces[k].sep !== "|") return false;
  for (let j = k; j < pieces.length - 1 && "|(){".includes(pieces[j].sep || "x"); j++) {
    if (FEEDS.test(base(stripPrefix(tokens(pieces[j + 1].t)).rest[0] ?? ""))) return true;
  }
  return false;
}
// Inline interpreter code (node -e, python -c ...) is blanked too unless keepCode: it is
// not shell text, so execution points are read from it by analyzeDeletes instead.
function blankData(text, keepCode = false) {
  const pieces = scanSplit(text);
  return pieces.map((p, k) => {
    const { rest, opaque } = stripPrefix(tokens(p.t));
    const h = base(rest[0] ?? "");
    if (!keepCode && !opaque && INTERP.test(h) && !/^(?:pwsh|powershell|cmd)/i.test(h) && scriptFile(h, rest.slice(1).map(unqQ)).inline) return blankQuotes(p.t) + p.sep;
    const sub = h === "git" ? rest.slice(1).map(unq).find((t, i, a) => !t.startsWith("-") && !/^-[cC]$/.test(a[i - 1] ?? "")) : "";
    const prog = rest.slice(1).filter((t) => !t.startsWith("-")).map(unqQ).join(" ");
    const executes = (/^g?awk$/.test(h) && AWK_EXEC.test(prog)) || (h === "sed" && SED_EXEC.test(prog));
    return ((DATA_HEAD.test(h) || sub === "grep") && !opaque && !executes && !pipeFeeds(pieces, k) ? blankQuotes(p.t) : p.t) + p.sep;
  }).join("");
}

// Quote-aware pre-pass. An unquoted `#` at a word start comments out the rest of the line.
// Backticks and `$(` inside single quotes, or backslash-escaped, are inert: they become the
// placeholders \u0001 / $\u0002, which unprep() turns back where the text really is executed
// (bash -c '...', node -e '...').
function prepText(s) {
  let out = "", q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") {
      if (c === "'") { q = ""; out += c; }
      else if (c === "`") out += "\u0001";
      else if (c === "$" && s[i + 1] === "(") { out += "$\u0002"; i++; }
      else out += c;
      continue;
    }
    if (c === "\\") { const n = s[++i] ?? ""; out += n === "`" ? "\u0001" : c + n; continue; }
    if (q === '"') { if (c === '"') q = ""; out += c; continue; }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    if (c === "#" && (i === 0 || /[\s;&|(]/.test(s[i - 1]))) { while (i < s.length && s[i] !== "\n") i++; i--; continue; }
    out += c;
  }
  return out;
}
const unprep = (s) => String(s).replace(/\u0001/g, "`").replace(/\$\u0002/g, "$(");

export function commandView(command, keepCode = false) {
  const { text, code } = stripHeredocs(command);
  return { text: blankData(prepText(text), keepCode), code };
}

const HOME_VAR = String.raw`(?:~[\w.+-]*|\$HOME|\$USERPROFILE|%USERPROFILE%|%HOMEPATH%|\$env:(?:USERPROFILE|HOME)|\$\{env:(?:USERPROFILE|HOME)\})`;
const HOME_PATH = new RegExp(`^${HOME_VAR}(?:/(.*))?$`, "i");
const osHome = () => { try { return userInfo().homedir.replace(/\/+$/, ""); } catch { return ""; } };
const pathSegs = (s) => String(s ?? "").split("/").filter((x) => x && x !== ".");
const GLOB = /[*?{}[\]]/;

// What a path is relative to the home directory, in every spelling (shell variables, ~, ~user,
// /Users|/home|/root, C:\Users, the real home from the OS user database):
//   root   `/` or `/*`           state  the gate's own ~/.aos/gate and ~/.aos/go
//   home   the home directory (or something above it, or a `..` that may reach it)
//   child  one direct child of home; `real` is its filesystem path when known
//   glob   a glob or brace pattern at home level
// null = anywhere else. `${HOME:-x}` and `${HOME%/}` count as $HOME. A bare `*` is resolved
// against the working directory by the caller.
export function homeKind(p) {
  let s = String(p).replace(/["'`]/g, "").replace(/\$\{(HOME|USERPROFILE)(?:[:#%/^,@-][^}]*)?\}/gi, "$$HOME").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  if (s === "/" || s === "/*") return { kind: "root" };
  if (/(?:^|\/)\.aos\/(?:gate|go)(?:\/|$)/.test(s)) return { kind: "state" };
  const child = (name, real) => (GLOB.test(name) ? { kind: "glob" } : { kind: "child", name, real });
  let m = HOME_PATH.exec(s);
  if (m) {
    const r = pathSegs(m[1]);
    if (r.includes("..") || r.length === 0) return { kind: "home" };
    return r.length === 1 ? child(r[0], join(gateCtx.home || homedir(), r[0])) : null;
  }
  m = /^(?:[A-Za-z]:)?\/(?:Users|home)(?:\/(.*))?$/i.exec(s);
  if (m) {
    const r = pathSegs(m[1]);
    if (r.includes("..") || r.length <= 1) return { kind: "home" };
    return r.length === 2 ? child(r[1], /^\//.test(s) ? s : "") : null;
  }
  m = /^\/root(?:\/(.*))?$/.exec(s);
  if (m) {
    const r = pathSegs(m[1]);
    if (r.includes("..") || r.length === 0) return { kind: "home" };
    return r.length === 1 ? child(r[0], s) : null;
  }
  const rh = gateCtx.realHome ?? osHome();
  if (rh && (s === rh || s.startsWith(rh + "/"))) {
    const r = pathSegs(s.slice(rh.length));
    if (r.includes("..") || r.length === 0) return { kind: "home" };
    return r.length === 1 ? child(r[0], s) : null;
  }
  return null;
}
export const isHomeLevel = (p) => homeKind(p) !== null;

const entryType = (real) => {
  try { const st = lstatSync(real); return st.isDirectory() ? "dir" : "file"; } catch { return "missing"; }
};

// Policy for a delete, move or overwrite aimed at `p`:
//   "hard"  the home directory, `/`, the gate state, or (recursive delete, move, chmod/chown -R,
//           rsync --delete) a top-level directory of home, one that is missing or unknown, or a
//           home-level glob. Never liftable.
//   "go"    one file or symlink directly in home (checked with lstat), or a non-recursive delete
//           of a glob/directory there: needs a GO and is not grantable.
//   null    anything else.
// `op.recursive` covers the recursive family; `op.move` is mv.
function homeVerdict(p, op = {}) {
  const k = homeKind(p);
  if (!k) return null;
  if (k.kind === "root" || k.kind === "home" || k.kind === "state") return "hard";
  const strong = op.recursive || op.move;
  if (k.kind === "glob") return strong ? "hard" : "go";
  return k.real && entryType(k.real) === "file" ? "go" : strong ? "hard" : "go";
}

// A dotfile directly in home that a command overwrites (`> ~/.x`, tee, dd of=, cp, ln -f, truncate).
const isHomeDotfile = (p) => { const k = homeKind(p); return !!k && k.kind === "child" && k.name.startsWith("."); };

const DEL_CMD = /^(?:rm|rmdir|unlink|shred|remove-item|ri|del|erase|rd|trash)$/i;
const PS_REC = /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?$/i;
const rmRecursive = (tok) => {
  const r = tok.slice(1).map(unq), end = r.indexOf("--");
  return r.slice(0, end === -1 ? undefined : end).some((t) => /^-[a-zA-Z]*[rR]/.test(t) || t === "--recursive");
};

// Delete targets of one simple command (after prefix stripping) and whether it is recursive.
function shellDelete(tok) {
  const cmd = base(tok[0] ?? "").toLowerCase();
  const a = tok.slice(1).map(unqQ).filter((t) => !/^\d*>/.test(t));
  if (DEL_CMD.test(cmd)) {
    const dd = a.indexOf("--");
    const targets = a.filter((t, i) => i !== dd && (dd !== -1 && i > dd || !(t.startsWith("-") || /^\/[a-z]$/i.test(t))));
    const ps = /^(?:remove-item|ri|rm|rmdir|rd|del|erase)$/.test(cmd) && a.some((t) => PS_REC.test(t) || /^\/s$/i.test(t));
    return { targets, recursive: ps || (cmd === "rm" && rmRecursive(tok)) };
  }
  if (cmd === "find") {
    const j = a.join(" ");
    if (!/(?:^|\s)-delete\b|-exec(?:dir)?\s+(?:\S*\/)?(?:rm|rmdir|unlink)\b/.test(j)) return { targets: [], recursive: false };
    let i = 0;
    while (/^(?:-[HLP]|-D|-O\d)$/.test(a[i] ?? "")) i += a[i] === "-D" ? 2 : 1;
    const targets = [];
    for (; i < a.length && !/^[-(!]/.test(a[i]); i++) targets.push(a[i]);
    return { targets: targets.length ? targets : ["."], recursive: true };
  }
  const pos = a.filter((t) => !t.startsWith("-"));
  // Moving a home-level path away destroys it as surely as deleting it.
  if (cmd === "mv") return { targets: pos.length > 1 ? pos.slice(0, -1) : [], recursive: false, move: true, writes: pos.length > 1 ? pos.slice(-1) : [] };
  if (cmd === "rsync" && a.some((t) => /^--(?:del|delete\S*|remove-source-files)$/.test(t))) return { targets: pos.slice(-1), recursive: true };
  if (/^(?:chmod|chown|chgrp)$/.test(cmd) && a.some((t) => /^-[a-zA-Z]*R|^--recursive$/.test(t))) return { targets: pos.slice(1), recursive: false, strong: true };
  // Overwrites of a dotfile directly in home need a GO (the `writes` list is checked separately).
  if (cmd === "truncate") return { targets: [], recursive: false, writes: pos };
  if (cmd === "tee" && !a.some((t) => /^-[a-zA-Z]*a|^--append$/.test(t))) return { targets: [], recursive: false, writes: pos };
  if (cmd === "dd") return { targets: [], recursive: false, writes: a.filter((t) => t.startsWith("of=")).map((t) => t.slice(3)) };
  if (cmd === "cp" || cmd === "install") return { targets: [], recursive: false, writes: pos.slice(-1) };
  if (cmd === "ln" && a.some((t) => /^-[a-zA-Z]*f|^--force$/.test(t))) return { targets: [], recursive: false, writes: pos.slice(-1) };
  if (cmd === "rimraf" || (/^(?:npx|pnpm|yarn|bunx|npm|bun|dlx)$/.test(cmd) && tok.slice(0, 5).some((t) => base(t) === "rimraf"))) {
    const i = tok.findIndex((t) => base(t) === "rimraf");
    return { targets: tok.slice(i + 1).map(unqQ).filter((t) => !t.startsWith("-")), recursive: true };
  }
  return { targets: [], recursive: false };
}

// Interpreter code is never matched as shell text. Only execution points count: delete APIs,
// process-spawning calls (their command text is analysed like a shell command) and the
// markers of code that hides what it runs (UNSCOPED_CODE).
const RECURSIVE_CALL = /^(?:rmtree|remove_tree|rm_rf|rm_r|remove_entry(?:_secure)?|remove_dir|removedirs|rimraf(?:Sync)?)$/;
const OPTION_CALL = /^(?:rmSync|rmdirSync|(?:fs|fsp|fsPromises|promises)\.(?:rm|rmdir)|Deno\.remove(?:Sync)?)$/;
const UNSCOPED_CODE = /(?<![.\w])(?:eval|exec)\s*(?:\(|["'])|(?<![.\w])compile\s*\(|\bnew\s+Function\b|(?<![.\w])Function\s*\(|__import__\s*\(|b64decode|\batob\b|base64\s*\.\s*\w*decode|codecs\.decode|\bvm\.run\w*/;
const EXEC_CALL = /(?<![\w])(?:subprocess\.(?:run|call|check_call|check_output|Popen|getoutput|getstatusoutput)|os\.(?:system|popen|exec\w*|spawn\w*)|pty\.spawn|(?:child_process|cp)\.(?:exec|execSync|spawn|spawnSync|execFile|execFileSync)|execSync|spawnSync|execFileSync|execFile|spawn|execa(?:Sync)?|Deno\.Command|Kernel\.system|(?<![.\w])system|popen)\s*\(?\s*/g;
const DEL_CALL = /\b(?:rmSync|rmdirSync|unlinkSync|rimraf(?:Sync)?|rmtree|remove_tree|rm_rf|rm_r|rm_f|remove_entry(?:_secure)?|remove_dir|removedirs|(?:fs|fsp|fsPromises|promises)\.(?:rm|rmdir|unlink)|os\.(?:remove|unlink|rmdir)|Deno\.remove(?:Sync)?|File\.delete|Dir\.(?:rmdir|delete|unlink))(?!\w)\s*\(?\s*/g;
const HOME_EXPR = /^(?:process\.env(?:\.(?:HOME|USERPROFILE)|\[\s*['"](?:HOME|USERPROFILE)['"]\s*\])|Deno\.env\.get\(\s*['"]HOME['"]\s*\)|(?:(?:require\(\s*['"](?:node:)?os['"]\s*\)|\w+)\.)?homedir\(\s*\)|(?:require\(\s*['"](?:node:)?os['"]\s*\)|\w+)\.userInfo\(\s*\)\.homedir|(?:pathlib\.)?Path\.home\(\s*\)|os\.environ(?:\[\s*['"]HOME['"]\s*\]|\.get\(\s*['"]HOME['"][^)]*\))|os\.getenv\(\s*['"]HOME['"][^)]*\)|ENV\[\s*['"]HOME['"]\s*\]|Dir\.home|\$ENV\{HOME\}|\$env:(?:HOME|USERPROFILE))/i;
const WRAP_CALL = /^(?:(?:(?:require\(\s*['"](?:node:)?path['"]\s*\)|path(?:\.posix|\.win32)?)\.)?(?:join|resolve)|(?:pathlib\.)?Path|os\.path\.(?:join|expanduser)|File\.(?:join|expand_path)|Pathname\.new)\(\s*/;
const LIT = /^[frbuFRBU]{0,2}(["'`])((?:\\.|(?!\1)[^\\])*)\1/;
const MORE = /^\s*\)?\s*[,+/]\s*[frbuFRBU]{0,2}(["'`])((?:\\.|(?!\1)[^\\])*)\1/;

// The path a delete call's first argument spells, as shell-like text: home expressions
// become `~`, literal tails are appended, an unreadable tail counts as one more segment.
function codeArgToPath(src) {
  let a = src;
  for (let m; (m = WRAP_CALL.exec(a));) a = a.slice(m[0].length);
  let p, rest;
  const he = HOME_EXPR.exec(a), lit = he ? null : LIT.exec(a);
  if (he) { p = "~"; rest = a.slice(he[0].length); }
  else if (lit) { p = lit[2].replace(/\$?\{[^}]*(?:home|USERPROFILE)[^}]*\}/gi, "~"); rest = a.slice(lit[0].length); }
  else return "";
  for (let m; (m = MORE.exec(rest));) { p += "/" + m[2]; rest = rest.slice(m[0].length); }
  if (/^\s*\)?\s*[+/]\s*[^\s'"`]/.test(rest)) p += "/*";
  return p;
}

// Same text with string-literal contents blanked (length kept), so matches align with `text`.
// Single-line quotes only: an apostrophe in a comment must not swallow the code after it.
const maskStrings = (s) => s.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
  (m) => m[0] + m.slice(1, -1).replace(/[^\n]/g, " ") + m[m.length - 1]);

// The command text of a spawn call's arguments: a literal, or a list of literals (a
// non-literal element becomes $X). "" = the first argument is not a literal.
function execCommand(src, name) {
  const s = src.trimStart();
  const list = (t) => {
    const out = [];
    t = t.slice(1);
    for (;;) {
      t = t.replace(/^\s*,?\s*/, "");
      const m = LIT.exec(t);
      if (m) { out.push(m[2]); t = t.slice(m[0].length); continue; }
      if (!t || t[0] === "]") break;
      out.push("$X");
      t = t.replace(/^[^,\]]*/, "");
    }
    return { out, rest: t.slice(1) };
  };
  if (s[0] === "[") return list(s).out.join(" ");
  const lit = LIT.exec(s);
  if (!lit) return "";
  const parts = [lit[2]], rest = s.slice(lit[0].length);
  if (/^\s*[+%]/.test(rest)) parts.push("$X");
  const second = /^\s*,\s*(\[)/.exec(rest);
  if (second) {
    const l = list(rest.slice(second[0].length - 1)).out;
    if (/^os\.(?:exec|spawn)/.test(name)) return l.join(" ");
    parts.push(...l);
  }
  return parts.join(" ");
}

// Code of an interpreter, inspected at execution points only. Sets r.hard / r.destructive /
// r.unscoped and pushes spawned command texts to r.cmds (the caller classifies those).
function codeInto(r, text, lang = "") {
  text = unprep(text);
  if (lang === "osascript" && /\bdelete\b|\bmove\b[^\n;]*\bto\b[^\n;]*\btrash|\bdo shell script\b/i.test(text)) r.unscoped = true;
  const masked = maskStrings(text);
  if (UNSCOPED_CODE.test(masked) || HTTP_PATTERNS.some((re) => re.test(text))) r.unscoped = true;
  for (const m of masked.matchAll(DEL_CALL)) {
    const name = m[0].replace(/\s*\(?\s*$/, "");
    const after = text.slice(m.index + m[0].length);
    const rec = RECURSIVE_CALL.test(name.replace(/^.*\./, "")) || (OPTION_CALL.test(name) && /recursive/.test(after.slice(0, 300)));
    if (rec) r.destructive = true;
    const p = codeArgToPath(after);
    const v = p ? homeVerdict(p, { recursive: rec }) : null;
    if (v === "hard") r.hard ||= p;
    else if (v === "go") r.unscoped = true;
  }
  for (const m of masked.matchAll(EXEC_CALL)) {
    const c = execCommand(text.slice(m.index + m[0].length), m[0].replace(/\s*\(?\s*$/, ""));
    if (c) r.cmds.push(c);
  }
  if (/^(?:ruby|perl)$/.test(lang)) {
    for (const m of text.matchAll(/`([^`\n]*)`|%x[({[]([^)}\]]*)|\bqx[({[]([^)}\]]*)/g)) r.cmds.push(m[1] ?? m[2] ?? m[3]);
  }
}

// Script files run by an interpreter. cwd follows `cd X &&` inside the command; the hook's
// own cwd (setGateContext) is the start. Block cooldown: see markBlock.
let gateCtx = { cwd: "", blockTs: 0 };
export const setGateContext = (c) => { gateCtx = { cwd: "", blockTs: 0, ...c }; };
export const COOLDOWN_MS = 10 * 60 * 1000;
export const COOLDOWN_MESSAGE = "go-gate: blocked recently; a freshly written script after a block needs a GO; stop and report.";
const FILE_HEAD = /^(?:python[\d.]*|node(?:js)?|bun|deno|ruby|perl|php|bash|sh|zsh|dash|ksh|pwsh|powershell|osascript)$/i;
const INLINE_FLAG = /^(?:-[a-zA-Z]*[ce]|--eval|-p|--print|-command|-c)$/i;
const VALUE_FLAG = /^(?:-r|--require|--import|--loader|--experimental-loader|--env-file|--input-type|-C|--conditions|-W|-X|-Q|-I)$/;
const SCRIPT_MAX = 256 * 1024;
const expandHome = (p) => p.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir());

function scriptFile(h, a) {
  const lc = h.toLowerCase();
  const args = a.filter((t) => !/^\d*>/.test(t));
  let i = 0;
  if (/^(?:deno|bun)$/.test(lc) && /^(?:run|eval)$/.test(args[0] ?? "")) { if (args[0] === "eval") return { inline: true }; i = 1; }
  for (; i < args.length; i++) {
    const t = args[i];
    if (t === "-m") return { module: args[i + 1] ?? "" };
    if (t === "-") return {};
    if (INLINE_FLAG.test(t) && !/^(?:bash|sh|zsh|dash|ksh)$/.test(lc)) return { inline: true };
    if (/^(?:-c|-[a-zA-Z]*c)$/.test(t) && /^(?:bash|sh|zsh|dash|ksh)$/.test(lc)) return { inline: true };
    if (VALUE_FLAG.test(t)) { i++; continue; }
    if (t.startsWith("-")) continue;
    return { file: t };
  }
  return {};
}

function scriptInto(r, h, file, cwd) {
  const path = resolve(expandHome(cwd), expandHome(file));
  let st, mtime;
  try { st = statSync(path); mtime = Math.max(st.mtimeMs, lstatSync(path).mtimeMs); } catch { r.unscoped = true; return; }
  // Only a regular file is ever opened: a device (/dev/zero), FIFO, socket or directory is
  // unscoped and never read (a read could hang the hook). statSync follows a symlink.
  if (!st.isFile()) { r.unscoped = true; return; }
  // Cooldown limits, said plainly: an agent can still backdate a script (touch -t), run one
  // written before the block, or remove the marker through a path built at run time; the
  // last is covered only for literal paths (isHomeLevel knows ~/.aos/gate).
  if (gateCtx.blockTs && Date.now() - gateCtx.blockTs < COOLDOWN_MS && mtime > gateCtx.blockTs) { r.unscoped = true; r.cooldown = true; return; }
  if (st.size > SCRIPT_MAX) { r.unscoped = true; return; }
  let body;
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(SCRIPT_MAX + 1);
      let n = 0;
      for (let k; n < buf.length && (k = readSync(fd, buf, n, buf.length - n, n)) > 0;) n += k;
      if (n > SCRIPT_MAX) { r.unscoped = true; return; }
      body = buf.toString("utf8", 0, n);
    } finally { closeSync(fd); }
  } catch { r.unscoped = true; return; }
  if (/^(?:bash|sh|zsh|dash|ksh|pwsh|powershell)$/i.test(h)) r.cmds.push(body);
  else codeInto(r, body, h.toLowerCase().replace(/[\d.]+$/, "").replace(/^nodejs$/, "node"));
}

// Text a shell/eval/xargs/cmd/pwsh runs, from its tokens (after prefix stripping).
function innerText(tok) {
  const h = base(tok[0] ?? ""), un = (t) => unprep(String(t).replace(/^(["'])([\s\S]*)\1$/, "$2"));
  if (/^(?:bash|sh|zsh|dash|ksh)$/.test(h)) {
    const i = tok.findIndex((t, k) => k && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(unqQ(t)));
    return i > 0 ? tok.slice(i + 1).map(un).join(" ") : "";
  }
  if (/^(?:cmd(?:\.exe)?|pwsh|powershell)$/i.test(h)) {
    const i = tok.findIndex((t, k) => k && /^(?:\/[ck]|-c|-command)$/i.test(unqQ(t)));
    return i > 0 ? tok.slice(i + 1).map(un).join(" ") : "";
  }
  return tok.slice(SHELLS.test(h) ? 1 : 0).map(un).join(" ");
}

// Shell state followed through one command: the working directory (cd, pushd, subshells) and
// plain VAR=value assignments. A relative delete target is resolved against it; a target that
// still holds a variable or substitution after expansion cannot be judged and is unscoped.
const ABS_LIKE = /^(?:\/|~|\$HOME|\$USERPROFILE|%|\$env:|[A-Za-z]:[\\/])/i;
const OWN_VAR = /^(?:HOME|USERPROFILE)$/i;
function normPath(p) {
  const out = [];
  for (const x of p.replace(/\\/g, "/").split("/")) {
    if (!x || x === ".") continue;
    if (x === ".." && out.length && out.at(-1) !== ".." && !/^(?:~[\w.+-]*|\$HOME|\$USERPROFILE|%\w+%|\$env:\w+)$/i.test(out.at(-1))) { out.pop(); continue; }
    out.push(x);
  }
  return (p.startsWith("/") ? "/" : "") + out.join("/");
}
function expandVars(s, st) {
  s = s.replace(/\$\{(HOME|USERPROFILE)(?:[:#%/^,@-][^}]*)?\}/gi, "$$HOME");
  for (let k = 0; k < 6 && /[$`]/.test(s); k++) {
    s = s.replace(/\$\(\s*pwd\s*\)|`\s*pwd\s*`|\$\{PWD\}|\$PWD(?!\w)/g, () => st.cwd)
      .replace(/\$\(\s*echo\s+((?:[^()$`]|\$HOME(?!\w))*?)\s*\)|`\s*echo\s+((?:[^`$()]|\$HOME(?!\w))*?)\s*`/g, (_, a, b) => a ?? b)
      .replace(/\$\{(\w+)(?::?[-=+?][^}]*)?\}|\$(\w+)/g, (m, a, b) => {
        const n = a ?? b;
        return OWN_VAR.test(n) ? "$HOME" : typeof st.vars[n] === "string" ? st.vars[n] : m;
      });
  }
  const left = s.replace(/\$HOME(?!\w)|\$env:\w+/gi, "");
  return /[$`\u0001\u0002]/.test(left) ? null : s;
}
const resolveTarget = (t, st) => {
  const e = expandVars(unprep(t), st);
  if (e === null) return null;
  return ABS_LIKE.test(e) ? e : normPath(`${st.cwd}/${e}`);
};
const ASSIGN = /^([A-Za-z_]\w*)=([\s\S]*)$/;
const assignments = (raw, st) => {
  let i = 0;
  while (/^(?:export|declare|typeset|local|readonly)$/.test(unq(raw[i] ?? "")) || (i > 0 && /^-\w+$/.test(raw[i] ?? ""))) i++;
  for (; i < raw.length; i++) {
    const m = ASSIGN.exec(raw[i]);
    if (!m) return;
    const v = expandVars(unqQ(m[2]), st);
    st.vars[m[1]] = v === null ? null : v;
  }
};
const cdTarget = (tok, st) => {
  const t = tok.slice(1).map(unqQ).find((x) => !/^-[LPe@]+$/.test(x));
  const home = gateCtx.cwd || process.cwd();
  if (t === undefined) return "~";
  const e = expandVars(unprep(t), st);
  if (e === null || e === "-") return home;
  return ABS_LIKE.test(e) ? normPath(e) : normPath(`${st.cwd}/${e}`);
};

export function analyzeDeletes(command, depth = 0, init = null) {
  const r = { destructive: false, hard: null, unscoped: false, cooldown: false, cmds: [], files: [] };
  if (depth > 3 || typeof command !== "string") return r;
  if (command.length > MAX_COMMAND) { r.unscoped = true; return r; }
  const st = init ? { cwd: init.cwd, vars: { ...init.vars } } : { cwd: gateCtx.cwd || process.cwd(), vars: Object.create(null) };
  const snap = () => ({ cwd: st.cwd, vars: st.vars });
  const merge = (o) => { r.destructive ||= o.destructive; r.hard ||= o.hard; r.unscoped ||= o.unscoped; r.cooldown ||= o.cooldown; r.cmds.push(...o.cmds); r.files.push(...o.files); };
  const { text, code } = commandView(command, true);
  const un = (t) => String(t).replace(/^"([\s\S]*)"$/, (_, x) => x.replace(/\\(["\\$`])/g, "$1")).replace(/^'([\s\S]*)'$/, "$1");
  const stack = [];
  const segment = (seg) => {
    assignments(words(seg), st);
    const { rest: tok, opaque } = stripPrefix(words(seg));
    const d = shellDelete(tok);
    if (d.recursive) r.destructive = true;
    for (const t of d.targets) {
      const p = resolveTarget(t, st);
      if (p === null) { r.unscoped = true; continue; }
      const v = homeVerdict(p, { recursive: d.recursive || d.strong, move: d.move });
      if (v === "hard") r.hard ||= t;
      else if (v === "go") r.unscoped = true;
    }
    // Overwriting a dotfile directly in home (commands with a write target, and `>` redirects).
    const writes = [...(d.writes ?? [])];
    const w = words(seg);
    for (let i = 0; i < w.length; i++) {
      const m = /^\d*>(?!>)\|?(.*)$/.exec(unqQ(w[i]));
      if (m && !/^&/.test(m[1])) writes.push(m[1] || unqQ(w[i + 1] ?? ""));
    }
    for (const t of writes) {
      const p = resolveTarget(t, st);
      if (p !== null && isHomeDotfile(p)) r.unscoped = true;
    }
    const h = base(tok[0] ?? "");
    // A sed/awk program that executes (`1e cmd`, system()) is read like an opaque command text.
    if (h === "sed" || /^g?awk$/.test(h)) {
      const prog = tok.slice(1).filter((t) => !t.startsWith("-")).map(unqQ).join(" ");
      if ((h === "sed" ? SED_EXEC : AWK_EXEC).test(prog) && catchAll([prog], "", true)) r.unscoped = true;
    }
    if (/^(?:cd|pushd)$/.test(h)) st.cwd = cdTarget(tok, st);
    if (opaque || /^(?:cmd(?:\.exe)?|pwsh|powershell)$/i.test(h)) merge(analyzeDeletes(innerText(tok), depth + 1, snap()));
    if (FILE_HEAD.test(h) && (!opaque || /^(?:bash|sh|zsh|dash|ksh)$/.test(h))) {
      const f = scriptFile(h, tok.slice(1).map(unqQ));
      if (f.module && /rm|remov|delet|rimraf|trash|clean|purge|wipe/i.test(f.module)) r.unscoped = true;
      if (f.inline && INTERP.test(h) && !/^(?:pwsh|powershell)$/i.test(h)) codeInto(r, tok.slice(1).map(un).join(" "), h.toLowerCase().replace(/[\d.]+$/, ""));
      else if (f.file) r.files.push({ h, file: f.file, cwd: st.cwd });
    }
  };
  for (const p of scanSplit(text)) {
    if (p.t.trim()) segment(p.t.trim());
    if (p.sep === "(") stack.push(st.cwd);
    else if (p.sep === ")" && stack.length) st.cwd = stack.pop();
  }
  for (const c of code) codeInto(r, c.body, c.lang.replace(/[\d.]+$/, "").replace(/^nodejs$/, "node"));
  for (const m of text.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) merge(analyzeDeletes(unprep(m[1] ?? m[2]), depth + 1, snap()));
  // Spawned command texts are analysed too (their own cmds are classified by commandScopes).
  let seen = 0;
  const drain = () => {
    for (; seen < r.cmds.length; seen++) {
      if (depth >= 3) continue;
      const o = analyzeDeletes(r.cmds[seen], depth + 1, snap());
      r.destructive ||= o.destructive; r.hard ||= o.hard; r.unscoped ||= o.unscoped; r.cooldown ||= o.cooldown; r.files.push(...o.files);
    }
  };
  drain();
  // Script files are read last, and only when the shell text itself already holds no hard
  // block: nothing is opened for a command that is refused anyway.
  if (depth === 0) {
    for (let n = 0; r.files.length && !r.hard; n++) {
      if (n >= 16) { r.unscoped = true; break; }
      const f = r.files.shift();
      scriptInto(r, f.h, f.file, f.cwd);
      drain();
    }
    r.files.length = 0;
  }
  return r;
}

export function hardBlockReason(command) {
  const { hard } = analyzeDeletes(command);
  return hard ? `Blocked by go-gate: HARD BLOCK, unconditional. This command deletes or moves away the home directory, the filesystem root or a top-level directory of home (target: ${hard}). No GO, grant, mode or token lifts this block. Stop now and report this command to the user; do not rephrase it or try another tool, language or route to the same effect.` : null;
}

const segGuarded = (seg) => { const c = classify(seg); return c === null || c.length > 0 || GUARDED_PATTERNS.some((r) => r.test(seg)); };

// A compound command that also rewrites git's push configuration (GIT_CONFIG_*, an exported
// GIT_ variable, git config of push/remote/url keys, git remote add/set-url) can redirect the
// push that follows; the whole command then gets no scope.
const UNSAFE_COMPOUND = /GIT_CONFIG|\bexport\s+GIT_|\bgit\b[^;&|\n]*\bconfig\b[^;&|\n]*(?:push|remote\.|url\.|insteadof)|\bgit\b[^;&|\n]*\bremote\s+(?:add|set-url|rename|set-branches)\b/i;

// null = guarded but at least one guarded part maps to no scope (never covered by a grant).
// A shell reading commands from stdin (`... | sh`, `bash -s`, `source /dev/stdin`): the text it
// runs is whatever the other segments print, so their quoted words are the command.
function feedsShell(segs) {
  return segs.some((seg) => {
    const { rest } = stripPrefix(tokens(seg));
    const head = base(rest[0] ?? ""), args = rest.slice(1).map(unq);
    if (/^(?:sh|bash|zsh|dash|ksh|fish)$/.test(head)) return !args.some((a) => !a.startsWith("-")) || args.includes("-s") || args.includes("/dev/stdin");
    return /^(?:source|\.)$/.test(head) && args.some((a) => a === "/dev/stdin" || a === "-");
  });
}

let nest = 0;
export function commandScopes(command, protectedFor = staticResolver) {
  if (nest > 3) return null;
  nest++;
  try { return scopesOf(command, protectedFor); } finally { nest--; }
}

function scopesOf(orig, protectedFor) {
  if (commandTooLong(orig)) return null;
  const out = new Set();
  const segs = segments(orig);
  const command = commandView(orig).text;
  // Raw text on purpose: data that a later pipe stage turns into commands must stay visible.
  if (feedsShell(segs) && catchAll(tokens(String(orig)), "", true)) return null;
  // The working directory follows `cd X &&` so a bare push reads the right repository.
  let cwd = gateCtx.cwd || process.cwd();
  const outerCwd = segCwd;
  for (const seg of segs) {
    segCwd = cwd;
    let s;
    try { s = classify(seg, protectedFor); } finally { segCwd = outerCwd; }
    const cdTok = stripPrefix(tokens(seg)).rest;
    if (/^(?:cd|pushd)$/.test(base(cdTok[0] ?? "")) && cdTok[1]) cwd = resolve(expandHome(cwd), expandHome(unqQ(cdTok[1])));
    if (s === null) return null;
    if (!s.length && GUARDED_PATTERNS.some((r) => r.test(seg))) return null;
    s.forEach((x) => out.add(x));
  }
  const a = analyzeDeletes(orig);
  if (a.unscoped) return null;
  if (a.destructive) out.add("destructive");
  for (const c of a.cmds) {
    const s = commandScopes(c, protectedFor);
    if (s === null) return null;
    s.forEach((x) => out.add(x));
  }
  if (!out.size && GUARDED_PATTERNS.some((r) => r.test(command))) return null;
  if (out.size && UNSAFE_COMPOUND.test(command)) return null;
  return [...out];
}

export const isGuardedCommand = (command) =>
  typeof command === "string" && (commandTooLong(command) || GUARDED_PATTERNS.some((r) => r.test(commandView(command).text)) || (commandScopes(command) ?? [1]).length > 0);

// ---------------------------------------------------------------------------
// Grant store protection (Bash side; Write/Edit side is env-file-protection).
// Limit, said plainly: this is a string match on a normalised command (quotes and
// backslashes removed, `//` and `/./` folded, case-insensitive for APFS). It can
// NEVER catch: `cd ~/.aos && cp x gate/k`, a path built in a variable or by an
// interpreter from pieces that do not sit next to each other, a symlink or script
// created in an earlier command, here-docs, or any code the agent writes to a file
// and runs. The real protection is the transcript verification in effectiveGate:
// a forged store entry without a matching human entry is ignored.
// ---------------------------------------------------------------------------
const STORE_REF = /\.aos[/,\s+]+(?:\.[/]+)*(?:gate|go)(?![\w.-])|\.aos\/+[^\s/]*[$*?[{]/i;
export function gateStoreReason(command) {
  if (typeof command !== "string") return null;
  const norm = command.replace(/["'\\]/g, "").replace(/\/(?:\.?\/)+/g, "/");
  // `cd <anything>/.aos` followed by a relative gate/ or go/ path (`cd ~/.aos && rm gate/x`).
  const cdAos = /\bcd\s+\S*\.aos\/*\s*(?:&&|;|\|\||\n)([\s\S]*)$/i.exec(norm);
  if (!STORE_REF.test(norm) && !(cdAos && /(?:^|[\s>])(?:gate|go)(?:\/|\s*$)/.test(cdAos[1]))) return null;
  // `>` covers redirects and `>(`; `<(` and `$(`/backticks run commands of their own.
  const readOnly = !/[>\x60]|\$\(|<\(/.test(norm) &&
    norm.split(/&&|\|\||[;|&\n]/).every((s) => /^\s*(?:cat|ls|grep|head|tail|cd)\b/.test(s));
  return readOnly ? null : "Blocked by go-gate: the GO/grant store (~/.aos/gate, ~/.aos/go) is written only by the AOS hooks. Grants come from the human typing `gogate grant ...`; read-only cat/ls/grep/head/tail is allowed.";
}

// Unreadable stdin throws: safeMain denies (exit 2) instead of allowing with empty input.
function readStdin() {
  return readFileSync(0, "utf8");
}

// Block cooldown: the first block of a session writes <gate dir>/<session key>.block. For 10
// minutes after it, a script file written later than the block needs a GO whatever it holds
// (an agent that was just stopped must not write a new script and run it). The marker is
// not renewed inside its window, so repeated blocks cannot age a script past it.
let blockKey = "";
const blockFile = (key) => join(gateDir(), `${key}.block`);
export function readBlockTs(key) {
  // A marker from the future (a forged or skewed ts) counts as written now, never as later.
  try { return Math.min(Number(JSON.parse(readFileSync(blockFile(key), "utf8")).ts) || 0, Date.now()); } catch { return 0; }
}
export function markBlock(key, now = Date.now()) {
  if (!key || now - readBlockTs(key) < COOLDOWN_MS) return;
  try {
    mkdirSync(gateDir(), { recursive: true, mode: 0o700 });
    writeFileSync(blockFile(key), JSON.stringify({ ts: now }), { mode: 0o600 });
  } catch { /* the cooldown is best effort; the block itself already holds */ }
}

// Cooldown key: the session id; without one (Antigravity, other hosts) a conversation id, else
// the transcript path, else the cwd, each prefixed so it never collides with a real session id.
// A host that sends none of these has no cooldown.
export const nameKey = (name) => sessionKey(`name-${slug(String(name ?? ""))}`);
function hookBlockKey(input, isAgy) {
  const pick = [!isAgy && input.session_id, input.conversationId, input.transcript_path, input.transcriptPath, input.cwd].find((v) => typeof v === "string" && v);
  if (!pick) return "";
  return pick === input.session_id && !isAgy ? sessionKey(pick) : sessionKey(`x-${pick}`);
}

function respond(isAgy, allowed, reason = "", command = "", hard = false) {
  if (!allowed) markBlock(blockKey);
  if (hard) {
    console.log(JSON.stringify({ decision: "deny", reason: `[MECHANICAL GO-GATE BLOCKED] ${reason}` }));
    process.stderr.write(`${reason}\n`);
    process.exit(isAgy ? 0 : 2);
  }
  if (isAgy) {
    if (allowed) {
      console.log(JSON.stringify({ decision: "allow" }));
    } else {
      console.log(JSON.stringify({
        decision: "deny",
        reason: `[MECHANICAL GO-GATE BLOCKED] Der Befehl "${command.slice(0, 100)}" wurde blockiert. Er erfordert ein frisches, isoliertes "GO" als letzte Benutzereingabe. ${reason}`
      }));
    }
    process.exit(0);
  } else {
    // Claude Code harness
    if (allowed) {
      process.exit(0);
    } else {
      process.stderr.write(
        `Blocked by go-gate hook: command "${command.slice(0, 80)}" requires a fresh, literal "GO" as your last message. ${reason}\n`
      );
      process.exit(2);
    }
  }
}

function extractClaudeText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

function extractAgyText(rawContent) {
  if (!rawContent || typeof rawContent !== "string") return "";
  // Strip metadata tags if present
  let text = rawContent.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "");
  const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (match) {
    text = match[1];
  }
  return text.trim();
}

export const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

// ---------------------------------------------------------------------------
// Origin. Claude Code user entries carry origin.kind (human, peer,
// task-notification, coordinator, auto-continuation), promptSource (typed,
// queued, suggestion_accepted, sdk, system), turnOrigin, isMeta, and
// sourceToolUseID for model-invoked skills. Typed prompts have origin.kind
// "human" + promptSource "typed"; older entries and slash-command wrapper
// entries (<command-name>) usually carry neither origin nor promptSource.
//
// isHumanEntry (enough for a plain GO): origin present -> kind exactly "human"
// and promptSource absent/typed/queued; origin absent -> promptSource absent or
// typed. Always: turnOrigin absent or "human", not meta/sidechain/compact
// summary/tool result/skill injection, no scheduler/wakeup/cron/loop keys.
// suggestion_accepted (model-written text, one keypress) and sdk never count.
//
// isStrictHumanEntry (required to SET a mode or grant): additionally needs
// positive evidence, origin.kind "human" or promptSource "typed". The asymmetry
// is deliberate: a plain GO unlocks one command once and a later entry closes it
// again; a mode or grant lasts up to 24h, so an entry with no origin data at all
// (legacy, or a scheduled prompt recorded without fields) must not create one.
// ---------------------------------------------------------------------------
// Exact key names (not substrings: `isLoopback` is harmless). The positive allowlist below
// (origin.kind human, promptSource typed/queued) remains the real rule; this only adds
// explicit rejections for shapes a scheduler, cron, wakeup or loop is known/expected to use.
const SCHEDULED_KEYS = new Set(["scheduledTaskId", "scheduledFireId", "wakeupSource", "scheduleId", "cronId", "loopId", "scheduled", "scheduledTask", "cronTask", "loopTask"]);
const SCHEDULED_VALUE = /schedul|wakeup|cron|loop/i;
const hasSchedulerMark = (o, depth = 0) => {
  if (!o || typeof o !== "object" || depth > 4) return false;
  return Object.entries(o).some(([k, v]) => SCHEDULED_KEYS.has(k) || (depth > 0 && typeof v === "string" && SCHEDULED_VALUE.test(v)) ||
    ((k === "origin" || depth > 0) && hasSchedulerMark(v, depth + 1)));
};
export function isHumanEntry(e) {
  if (!e || typeof e !== "object") return false;
  if (e.type === "USER_INPUT" || e.source === "USER_EXPLICIT") return true; // Antigravity: no origin info exists
  if (e.type !== "user" && e.role !== "user") return false;
  if (e.isSidechain === true || e.isMeta === true || e.isCompactSummary === true || e.isVisibleInTranscriptOnly === true) return false;
  if (e.sourceToolUseID || e.toolUseResult !== undefined) return false;
  if (hasSchedulerMark(e)) return false;
  if (e.origin !== undefined && (!e.origin || typeof e.origin !== "object")) return false;
  if (e.turnOrigin !== undefined && e.turnOrigin !== "human") return false;
  if (e.origin !== undefined) return e.origin.kind === "human" && [undefined, "typed", "queued"].includes(e.promptSource);
  return e.promptSource === undefined || e.promptSource === "typed";
}
export const isStrictHumanEntry = (e) =>
  isHumanEntry(e) && e.type === "user" && (e.origin?.kind === "human" || (e.origin === undefined && e.promptSource === "typed"));

// OpenCode parts: synthetic = model-only, ignored = display-only, aos_bus / aos_loop
// (any loop|aos_ metadata key) = plugin-injected. None of them is a human turn.
export const isHumanPart = (p) => !!p && p.type === "text" && typeof p.text === "string" && !p.synthetic && !p.ignored &&
  !(p.metadata && typeof p.metadata === "object" && Object.keys(p.metadata).some((k) => /loop|aos_/i.test(k)));

// ---------------------------------------------------------------------------
// GO and GO <PR references>
// Strict grammar, nothing else counts: `GO` alone (any case), or `GO` followed
// only by PR references `#117` / `PR 117` / `PR #117` (PR in capitals), separated
// by spaces, commas or exactly the connectors und/and, with an optional für/for
// right after GO. Decision: the connectors are allowed because Tim's real
// message was "GO für #117 und #118"; every other word makes it prose. Spaces
// and tabs only, so no line break of any kind (CR, LF, U+0085, U+2028) fits.
// A PR-only text is never a session name, so no known-session lookup applies.
// ---------------------------------------------------------------------------
const REF = String.raw`(?:#\d+|PR[ \t]*#[ \t]*\d+|PR[ \t]+\d+)`;
const GO_PRS = new RegExp(String.raw`^[Gg][Oo](?:[ \t]+(?:für|for))?[ \t]+${REF}(?:(?:[ \t]*,[ \t]*|[ \t]+(?:(?:und|and)[ \t]+)?)${REF})*$`);

// `GO` -> { ok, prs: null }; `GO <refs>` -> { ok, prs }.
export function parseGoText(text) {
  const t = String(text ?? "").trim();
  if (/^GO$/i.test(t)) return { ok: true, prs: null };
  if (GO_PRS.test(t)) return { ok: true, prs: [...t.matchAll(/(\d+)/g)].map((m) => Number(m[1])) };
  return { ok: false, reason: `last user message is not a GO (GO alone, or GO #117 #118): ${JSON.stringify(t.slice(0, 120))}` };
}

const ghPrTarget = (seg) => {
  const { rest: tok, opaque } = stripPrefix(tokens(seg));
  if (opaque || base(tok[0]) !== "gh") return null;
  const { a, b, rest } = ghParts(tok);
  if (a !== "pr") return null;
  const nums = rest.flatMap((x) => { const m = /^#?(\d+)$/.exec(x) || /\/pull\/(\d+)/.exec(x); return m ? [Number(m[1])] : []; });
  return { sub: b, nums };
};

// A plain GO covers the command. A PR GO covers ONLY gh pr merge|edit|close|review|comment
// whose PR numbers are all in its list; every other guarded part of the same command needs
// a plain GO. `--repo`/`-R` is not compared: which repo a number belongs to cannot be known,
// so only the number has to match.
export function goAllows(go, command) {
  if (!go?.ok) return false;
  if (!go.prs) return true;
  if (commandTooLong(command)) return false;
  if (commandScopes(command) === null) return false; // something in it cannot be classified
  let guardedSeen = false;
  for (const seg of segments(command)) {
    if (!segGuarded(seg)) continue;
    guardedSeen = true;
    const pr = ghPrTarget(seg);
    if (!pr || !/^(?:merge|edit|close|review|comment)$/.test(pr.sub) || !pr.nums.length || pr.nums.some((n) => !go.prs.includes(n))) return false;
  }
  return guardedSeen || !isGuardedCommand(command);
}

// ---------------------------------------------------------------------------
// Transcript reading: line by line in 1 MB chunks (forward or from the end), so a
// huge transcript never becomes one giant string. Non-object lines are skipped.
// ---------------------------------------------------------------------------
const CHUNK = 1 << 20;
function* fileLines(path) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(CHUNK);
    let rest = Buffer.alloc(0);
    for (let n; (n = readSync(fd, buf, 0, CHUNK, null)) > 0;) {
      const chunk = Buffer.concat([rest, buf.subarray(0, n)]);
      let start = 0;
      for (let i; (i = chunk.indexOf(10, start)) !== -1; start = i + 1) if (i > start) yield chunk.toString("utf8", start, i);
      rest = chunk.subarray(start);
    }
    if (rest.length) yield rest.toString("utf8");
  } finally { closeSync(fd); }
}
function* fileLinesReverse(path) {
  const fd = openSync(path, "r");
  try {
    let pos = fstatSync(fd).size;
    let rest = Buffer.alloc(0);
    while (pos > 0) {
      const len = Math.min(CHUNK, pos);
      pos -= len;
      const b = Buffer.alloc(len);
      readSync(fd, b, 0, len, pos);
      const chunk = Buffer.concat([b, rest]);
      let end = chunk.length;
      for (let i; end > 0 && (i = chunk.lastIndexOf(10, end - 1)) !== -1; end = i) if (end > i + 1) yield chunk.toString("utf8", i + 1, end);
      rest = chunk.subarray(0, end);
    }
    if (rest.length) yield rest.toString("utf8");
  } finally { closeSync(fd); }
}
const parseEntry = (line) => { try { const e = JSON.parse(line); return e && typeof e === "object" && !Array.isArray(e) ? e : null; } catch { return null; } };

// ---------------------------------------------------------------------------
// Gogate commands and the per-session state store
// ---------------------------------------------------------------------------
export const MAX_GRANT_MS = 24 * 60 * 60 * 1000;
const SKEW_MS = 10 * 60 * 1000; // hook write time vs transcript entry timestamp (queued prompts land later); still bound by the typed duration
const UNIT = { m: 60e3, h: 3600e3, d: 86400e3 };

// Slash-command entries are stored as <command-name>/x</command-name>...<command-args>a</command-args>;
// only a text made of nothing but those tags is unwrapped.
const WRAPPER = /^(?:\s*<(command-(?:name|message|args))>[^<]*<\/\1>)+\s*$/;
export function normalizeCommandText(text) {
  let t = String(text ?? "").trim();
  if (WRAPPER.test(t)) {
    const name = /<command-name>([^<]*)<\/command-name>/.exec(t)?.[1]?.trim() || "";
    const args = /<command-args>([^<]*)<\/command-args>/.exec(t)?.[1] || "";
    t = `${name && !name.startsWith("/") ? "/" : ""}${name} ${args}`;
  }
  return t.replace(/\s+/g, " ").trim();
}
export const textHash = (text) => createHash("sha256").update(normalizeCommandText(text)).digest("hex");

// Two input forms. PLAIN (primary): the whole message is `gogate <hard|soft|off|status|grant ...>`,
// one line, nothing else; a typed prompt carries origin human + promptSource typed, so the
// strict check works. SLASH (`/bdb-aos:gogate`, `/bdb-aos-gogate`, `/gogate`): parsed too,
// but Claude Code mostly stores slash commands without origin, so they rarely verify.
// null = not a gogate command. Else { cmd, form } or { cmd: "grant", scopes, ms, session, form } or { error, form }.
const SLASH_FORM = /^\/(?:bdb-aos[:-])?gogate(?:\s+(.*))?$/i;
const PLAIN_FORM = /^gogate\s+((?:hard|soft|off|status|grant)\b.*)$/i;
export function parseGogate(text) {
  const norm = normalizeCommandText(text);
  let m = SLASH_FORM.exec(norm), form = "slash";
  if (!m) {
    m = PLAIN_FORM.exec(norm);
    form = "plain";
    if (!m || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(String(text ?? "").trim())) return null;
  }
  const r = parseGogateArgs((m[1] || "").split(" ").filter(Boolean));
  return { ...r, form };
}

function parseGogateArgs(args) {
  const sub = (args[0] || "status").toLowerCase();
  if (["hard", "soft", "off", "status"].includes(sub)) return args.length <= 1 ? { cmd: sub } : { error: `${sub} takes no arguments` };
  if (sub !== "grant") return { error: `unknown subcommand "${sub}" (hard|soft|off|status|grant)` };
  if (args.length !== 3) return { error: "usage: grant <scope[,scope...]> <15m|2h|1d|session>" };
  const scopes = [...new Set(args[1].toLowerCase().split(",").filter(Boolean))];
  const bad = scopes.filter((s) => !SCOPES.includes(s));
  if (!scopes.length || bad.length) return { error: `unknown scope ${bad.join(",") || "(none)"}; scopes: ${SCOPES.join(", ")}` };
  if (/^session$/i.test(args[2])) return { cmd: "grant", scopes, ms: MAX_GRANT_MS, session: true };
  const d = /^(\d+)([mhd])$/i.exec(args[2]);
  const ms = d ? Number(d[1]) * UNIT[d[2].toLowerCase()] : NaN;
  if (!(ms > 0)) return { error: `bad duration "${args[2]}" (15m, 2h, 1d or session)` };
  if (ms > MAX_GRANT_MS) return { error: `duration ${args[2]} exceeds the 24h maximum` };
  return { cmd: "grant", scopes, ms, session: false };
}

export const gateDir = () => join(homedir(), ".aos", "gate");
// Plain ids (Claude uuids) stay readable; anything that would be changed by slugging
// gets a hash suffix, so two different ids never share a key ("Sess-A" vs "sess-A").
export const sessionKey = (id) => {
  const raw = String(id ?? "");
  if (!raw) return "";
  return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(raw) ? raw : `${slug(raw).replace(/^\.+/, "").slice(0, 64) || "s"}-${createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
};
export const statePath = (key) => join(gateDir(), `${key}.json`);

export function readState(key) {
  try { return JSON.parse(readFileSync(statePath(key), "utf8")); } catch { return null; }
}
export function writeState(key, state) {
  mkdirSync(gateDir(), { recursive: true, mode: 0o700 });
  const tmp = `${statePath(key)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, statePath(key));
}
const LOG_MAX = 256 * 1024, LOG_KEEP = 500;
export function gateLog(key, line) {
  try {
    mkdirSync(gateDir(), { recursive: true, mode: 0o700 });
    const f = join(gateDir(), `${key}.log`);
    appendFileSync(f, `${new Date().toISOString()} ${String(line).slice(0, 400).replace(/[\r\n]+/g, " ")}\n`, { mode: 0o600 });
    if (statSync(f).size > LOG_MAX) writeFileSync(f, readFileSync(f, "utf8").split("\n").filter(Boolean).slice(-LOG_KEEP).join("\n") + "\n");
  } catch { /* logging never blocks */ }
}

// Gogate commands from human entries of a Claude transcript, oldest first. `strict`
// marks entries with positive human evidence; only those can set a mode or grant,
// but every human-looking one counts for revoking (hard) and for "latest mode".
export function claudeGogateCommands(transcriptPath) {
  const out = [];
  try {
    for (const line of fileLines(transcriptPath)) {
      if (!/gogate/i.test(line) || !line.includes('"user"')) continue;
      const e = parseEntry(line);
      if (!e || e.type !== "user" || !isHumanEntry(e)) continue;
      const text = extractClaudeText(e.message?.content ?? e.content).trim();
      const parsed = parseGogate(text);
      if (parsed && !parsed.error) out.push({ id: e.uuid ?? null, ts: Date.parse(e.timestamp), hash: textHash(text), parsed, strict: isStrictHumanEntry(e) });
    }
  } catch { return []; }
  return out;
}

const WEAK_HINT = "it came from a slash command, which Claude Code stores without human-origin data; type the plain form as the whole message instead, e.g. `gogate grant merge 2h` or `gogate off`";
const OC_HINT = "OpenCode accepts only the plain form (`gogate grant merge 2h`) typed as the whole message";
export const OPENCODE_MAX_GRANT_MS = 2 * 3600e3;

// Resolves mode and active grants for a session, verified against `cmds` (gogate commands
// of the session, oldest first, each marked `strict` when it has human-origin evidence).
// `source` is the transcript path (Claude) or "opencode:<sessionID>"; store entries for
// another source are rejected. Rules:
// - The mode is the latest usable mode command of the TRANSCRIPT: any `hard` (tightening
//   needs no proof), or a strict `soft`/`off`. A non-strict soft/off is ignored and leaves
//   the previous mode. soft/off also need their own store entry (written by go-grant), else hard.
// - OpenCode has no human-origin signal at all (a prompt posted through the HTTP API is a
//   plain text part), so there `off` is never honoured and grants last at most 2h.
// - Grants need a strict entry after the last hard; `until` is clamped to the typed duration.
export function effectiveGate(key, { source, cmds, opencode = false }, now = Date.now()) {
  const st = readState(key);
  const state = st && typeof st === "object" ? st : {};
  const rejected = [];
  const usable = (c) => c.parsed.cmd === "hard" || (c.strict && !(opencode && c.parsed.cmd === "off"));
  for (const c of cmds) {
    if (["soft", "off"].includes(c.parsed.cmd) && !usable(c)) {
      rejected.push(opencode && c.strict ? "mode off is never honoured on OpenCode" : `mode ${c.parsed.cmd} ignored: ${opencode ? OC_HINT : WEAK_HINT}`);
    }
  }
  const lastMode = [...cmds].reverse().find((c) => ["hard", "soft", "off"].includes(c.parsed.cmd) && usable(c));
  const match = (src, ok) => [...cmds].reverse().find((c) =>
    src && typeof src === "object" && src.transcript === source && c.hash === src.text_hash && (!src.uuid || c.id === src.uuid) &&
    Number.isFinite(c.ts) && Math.abs(c.ts - Date.parse(src.issued_at)) <= SKEW_MS && ok(c.parsed));
  const modes = [...(Array.isArray(state.modes) ? state.modes : []), ...(state.mode ? [{ mode: state.mode, source: state.mode_source }] : [])];
  let mode = "soft";
  if (lastMode?.parsed.cmd === "hard") mode = "hard";
  else if (lastMode) {
    const want = lastMode.parsed.cmd;
    if (!modes.some((m) => m && m.mode === want && match(m.source, (p) => p.cmd === want) === lastMode)) {
      mode = "hard";
      rejected.push(`mode "${want}" has no store entry for its transcript prompt`);
    } else if (want === "off" && now - lastMode.ts >= MAX_GRANT_MS) {
      mode = "hard";
      rejected.push("off expired after 24h");
    } else mode = want;
  }
  const lastHard = cmds.findLastIndex((c) => c.parsed.cmd === "hard");
  const grants = [];
  for (const g of Array.isArray(state.grants) ? state.grants : []) {
    const c = match(g?.source, (p) => p.cmd === "grant" && p.scopes.includes(g?.scope));
    if (!c) { rejected.push(`grant ${g?.scope} has no matching human gogate entry`); continue; }
    if (!c.strict) { rejected.push(`grant ${g?.scope} ignored: ${opencode ? OC_HINT : WEAK_HINT}`); continue; }
    if (cmds.indexOf(c) < lastHard) { rejected.push(`grant ${g.scope} revoked by a later hard`); continue; }
    if (c.parsed.session && g.session_key !== key) { rejected.push(`session grant ${g.scope} belongs to another session`); continue; }
    const until = Math.min(Date.parse(g.until), c.ts + (opencode ? Math.min(c.parsed.ms, OPENCODE_MAX_GRANT_MS) : c.parsed.ms));
    if (!(now < until)) continue; // expired
    grants.push({ scope: g.scope, until, session: !!c.parsed.session });
  }
  return { mode, grants, rejected };
}

export const grantsCover = (command, grants, protectedFor) => {
  const need = commandScopes(command, protectedFor);
  return !!need && need.length > 0 && need.every((s) => grants.some((g) => g.scope === s));
};

export function statusText(key, eff, now = Date.now()) {
  const lines = [`AOS go-gate, session ${key}: mode ${eff.mode}`];
  if (!eff.grants.length) lines.push("  no active grants");
  for (const g of eff.grants) lines.push(`  grant ${g.scope} until ${new Date(g.until).toISOString()} (${Math.ceil((g.until - now) / 60000)} min left${g.session ? "; session = this session id, max 24h, survives --resume" : ""})`);
  for (const r of [...new Set(eff.rejected)].slice(0, 5)) lines.push(`  ignored: ${r}`);
  return lines.join("\n");
}

export const listStateKeys = () => {
  try { return readdirSync(gateDir()).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)); } catch { return []; }
};
export const TOKEN_TTL_MS = 10 * 60 * 1000;

function ownSessionName(transcriptPath) {
  let name = "";
  try {
    for (const line of fileLines(transcriptPath)) {
      if (!line.includes('"agent-name"') && !line.includes('"custom-title"')) continue;
      const e = parseEntry(line);
      if (!e) continue;
      if (e.type === "agent-name" && typeof e.agentName === "string" && e.agentName) name = e.agentName;
      else if (e.type === "custom-title" && typeof e.customTitle === "string" && e.customTitle && !name) name = e.customTitle;
    }
  } catch { /* unreadable */ }
  return name || process.env.AOS_SESSION_NAME || "";
}

const CONSUMED_KEEP = 200;
const consumedFile = () => join(homedir(), ".aos", "go", ".consumed");
const readConsumed = () => {
  try { return readFileSync(consumedFile(), "utf8").split("\n").filter(Boolean); } catch (e) { return e.code === "ENOENT" ? [] : null; }
};

function opencodeLastUser(sessionId) {
  let db;
  try {
    const dbPath = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");
    if (typeof sessionId !== "string" || !existsSync(dbPath)) return null;
    const require = createRequire(import.meta.url);
    try {
      db = new (require("node:sqlite").DatabaseSync)(dbPath, { readOnly: true });
    } catch {
      db = new (require("bun:sqlite").Database)(dbPath, { readonly: true });
    }
    const ses = db.prepare("SELECT parent_id FROM session WHERE id = ?").get(sessionId);
    if (!ses || ses.parent_id != null) return null; // subagent sessions are agent-written, never a human GO
    const msg = db.prepare(
      "SELECT id FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created DESC, id DESC LIMIT 1"
    ).get(sessionId);
    if (!msg) return null;
    const text = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY id").all(msg.id)
      .map((r) => JSON.parse(r.data))
      // synthetic = model-only, ignored = display-only, aos_bus = bus delivery: none is a human turn.
      .filter(isHumanPart)
      .map((p) => p.text)
      .join("\n")
      .trim();
    return { id: msg.id, text };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

// Human gogate commands of a ROOT OpenCode session, oldest first (read-only db).
export function opencodeGogateCommands(sessionId) {
  let db;
  try {
    const dbPath = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");
    if (typeof sessionId !== "string" || !existsSync(dbPath)) return [];
    const require = createRequire(import.meta.url);
    try {
      db = new (require("node:sqlite").DatabaseSync)(dbPath, { readOnly: true });
    } catch {
      db = new (require("bun:sqlite").Database)(dbPath, { readonly: true });
    }
    const ses = db.prepare("SELECT parent_id FROM session WHERE id = ?").get(sessionId);
    if (!ses || ses.parent_id != null) return [];
    const out = [];
    const msgs = db.prepare("SELECT id, time_created FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created, id").all(sessionId);
    for (const m of msgs) {
      const text = db.prepare("SELECT data FROM part WHERE message_id = ? ORDER BY id").all(m.id)
        .map((r) => JSON.parse(r.data)).filter(isHumanPart).map((p) => p.text).join("\n").trim();
      const parsed = parseGogate(text);
      if (parsed && !parsed.error) out.push({ id: m.id, ts: Number(m.time_created), hash: textHash(text), parsed, strict: parsed.form === "plain" });
    }
    return out;
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

// Commands for whichever source a store entry names.
export const gogateCommandsFor = (source) =>
  String(source).startsWith("opencode:") ? opencodeGogateCommands(String(source).slice(9)) : claudeGogateCommands(source);

// Shared with bin/aos-acp.mjs (ACP permission requests). `consume: false`
// verifies without deleting the token, for a caller whose inner gate owns it.
export function tokenGrantsGo(own, { consume = true } = {}) {
  if (typeof own !== "string" || !slug(own)) return { ok: false, reason: "no session name derivable for token path" };
  const file = join(homedir(), ".aos", "go", `${slug(own)}.token`);
  if (!existsSync(file)) return { ok: false, reason: "no GO token for this session" };
  let tok;
  try {
    tok = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { ok: false, reason: "GO token unreadable" };
  }
  if (!tok || typeof tok !== "object") return { ok: false, reason: "GO token unreadable" };
  const age = Date.now() - Date.parse(tok?.issued_at);
  if (!(age >= 0 && age < TOKEN_TTL_MS)) {
    try { unlinkSync(file); } catch { /* already gone */ }
    return { ok: false, reason: "GO token expired" };
  }
  if (typeof tok.target !== "string" || slug(tok.target) !== slug(own)) {
    return { ok: false, reason: "GO token names another session" };
  }
  const want = `go ${own.trim().toLowerCase()}`;
  let key;
  if (tok.issuer === "opencode") {
    const last = opencodeLastUser(tok.master_session_id);
    if (!last || last.id !== tok.master_message_id || last.text.toLowerCase() !== want) {
      return { ok: false, reason: "master session no longer ends with this GO" };
    }
    key = last.id;
  } else if (typeof tok.master_transcript === "string") {
    const last = lastUserText(tok.master_transcript);
    if (!last.text || !last.human || last.text.trim().toLowerCase() !== want) {
      return { ok: false, reason: "master transcript no longer ends with this GO" };
    }
    if (!last.uuid) return { ok: false, reason: "master GO entry has no uuid" };
    key = last.uuid;
  } else {
    return { ok: false, reason: "GO token has no master transcript" };
  }
  const consumed = readConsumed();
  if (!consumed) return { ok: false, reason: "GO consumed list unreadable" };
  if (consumed.includes(key)) return { ok: false, reason: "GO already used" };
  if (consume) {
    try {
      // ponytail: read-modify-write, concurrent consumers in the same ms can drop a key; switch to append+trim if that ever matters.
      writeFileSync(consumedFile(), [...consumed, key].slice(-CONSUMED_KEEP).join("\n") + "\n");
      unlinkSync(file);
    } catch { return { ok: false, reason: "could not consume GO token" }; }
  }
  return { ok: true };
}

export function lastUserMessageIsGo(transcriptPath) {
  const last = lastUserText(transcriptPath);
  if (last.error) return { ok: false, reason: last.error };
  if (last.text === null) return { ok: false, reason: "no user message found in transcript" };
  if (!last.human) return { ok: false, reason: "last user message is not human-typed (loop, peer, task notification, SDK or system)" };
  return parseGoText(last.text);
}

function anyOrigin(transcriptPath) {
  for (const line of fileLinesReverse(transcriptPath)) {
    if (!line.includes('"origin"')) continue;
    const e = parseEntry(line);
    if (e && e.origin !== undefined) return true;
  }
  return false;
}

export function lastUserText(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return { text: null, error: "transcript path missing or not a string" };
  try {
    for (const line of fileLinesReverse(transcriptPath)) {
      const entry = parseEntry(line);
      if (!entry) continue; // partial, trailing or non-object lines

      // 1. Antigravity transcript entry format
      if (entry.type === "USER_INPUT" || entry.source === "USER_EXPLICIT") {
        const text = extractAgyText(entry.content);
        if (!text) continue;
        return { text, human: true };
      }

      // 2. Claude Code transcript entry format
      if (entry.type === "user" || entry.role === "user") {
        if (entry.isSidechain === true) continue;
        const content = entry.message?.content ?? entry.content;
        const text = extractClaudeText(content).trim();
        if (!text) continue;
        // Adaptive: once any entry of this transcript carries `origin`, Claude Code records
        // origin for typed prompts, so the last entry needs strict human evidence. The
        // lenient legacy rule (no origin, no promptSource) stays only for transcripts
        // where no entry has origin at all.
        const strictNeeded = entry.origin !== undefined || anyOrigin(transcriptPath);
        return { text, uuid: entry.uuid ?? null, human: strictNeeded ? isStrictHumanEntry(entry) : isHumanEntry(entry) };
      }
    }
  } catch (e) {
    return { text: null, error: `could not read transcript (${e.message})` };
  }
  return { text: null };
}

function main() {
  const rawInput = readStdin();
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch (e) {
      // Harness unknown: deny JSON on stdout (Antigravity) plus stderr + exit 2 (Claude Code/Codex) closes every path.
      const reason = `could not parse hook input: ${e.message}`;
      console.log(JSON.stringify({ decision: "deny", reason: `[MECHANICAL GO-GATE BLOCKED] ${reason}` }));
      process.stderr.write(`Blocked by go-gate hook: ${reason}\n`);
      process.exit(2);
    }
  }
  if (!input || typeof input !== "object") input = {};

  // Detect harness
  const isAgy = !!(input?.toolCall || input?.conversationId || input?.artifactDirectoryPath || input?.workspacePaths);

  // File-writing tools carry content, never a command.
  if (/^(?:write|edit|multiedit|notebookedit|apply_patch|patch|create|str_replace\w*)$/i.test(String(input?.tool_name ?? ""))) {
    respond(isAgy, true);
    return;
  }

  const raw =
    input?.toolCall?.args?.CommandLine ||
    input?.toolCall?.args?.command ||
    input?.tool_input?.command ||
    input?.command ||
    "";
  // An argv array is joined like aos-acp does; any other non-string value is refused.
  const command = Array.isArray(raw) ? raw.join(" ") : raw;
  if (typeof command !== "string") {
    respond(isAgy, false, "command in hook input is not a string; the gate cannot read it (ask for GO)", "");
    return;
  }
  if (!command.trim()) {
    respond(isAgy, true);
    return;
  }

  blockKey = hookBlockKey(input, isAgy);
  setGateContext({ cwd: typeof input.cwd === "string" ? input.cwd : "", blockTs: blockKey ? readBlockTs(blockKey) : 0 });

  // Over the length cap nothing is parsed: it is guarded, only a GO lifts it, and it is not a hard block.
  const tooLong = commandTooLong(command);
  if (!tooLong) {
    // Unconditional: before any GO, grant, mode or token is looked at.
    const hardReason = hardBlockReason(command);
    if (hardReason) {
      respond(isAgy, false, hardReason, command, true);
      return;
    }

    const storeReason = gateStoreReason(command);
    if (storeReason) {
      respond(isAgy, false, storeReason, command);
      return;
    }

    if (!isGuardedCommand(command)) {
      respond(isAgy, true);
      return;
    }
  }

  const transcriptPath = input?.transcriptPath || input?.transcript_path;
  if (typeof transcriptPath !== "string" || !transcriptPath) {
    respond(isAgy, false, "no transcript path in hook input — cannot verify GO", command);
    return;
  }
  if (input.session_id !== undefined && typeof input.session_id !== "string") {
    respond(isAgy, false, "session_id in hook input is not a string", command);
    return;
  }

  const go = lastUserMessageIsGo(transcriptPath);
  if (goAllows(go, command)) return respond(isAgy, true, "", command);
  const reasons = [go.ok ? "a GO with PR numbers covers only gh pr merge/edit/close/review/comment for those PRs; type a plain GO" : go.reason];
  const cooling = analyzeDeletes(command).cooldown;
  if (cooling) reasons.unshift(COOLDOWN_MESSAGE);
  if (tooLong) reasons.unshift(TOO_LONG_MESSAGE);

  // Modes and grants exist only where go-grant.mjs runs (Claude Code: session_id present).
  const key = !isAgy && input.session_id ? sessionKey(input.session_id) : "";
  if (key && !cooling && !tooLong) {
    const eff = effectiveGate(key, { source: transcriptPath, cmds: claudeGogateCommands(transcriptPath) });
    for (const r of eff.rejected) gateLog(key, `rejected: ${r}`);
    if (eff.mode === "off") {
      gateLog(key, `off: allowed ${JSON.stringify(command.slice(0, 200))}`);
      return respond(isAgy, true, "", command);
    }
    if (eff.mode === "soft" && grantsCover(command, eff.grants, makeBranchResolver(typeof input.cwd === "string" ? input.cwd : process.cwd(), spawnSync))) {
      gateLog(key, `grant: allowed ${JSON.stringify(command.slice(0, 200))}`);
      return respond(isAgy, true, "", command);
    }
    reasons.push(`mode ${eff.mode}, no active grant covers ${JSON.stringify(commandScopes(command) ?? "an unscoped command")}`);
  }

  const token = tokenGrantsGo(ownSessionName(transcriptPath));
  if (token.ok) return respond(isAgy, true, "", command);
  reasons.push(token.reason);
  respond(isAgy, false, reasons.join("; "), command);
}

// Never fail open: any exception (bad input shape, unreadable state, a bug) denies.
function safeMain() {
  try {
    main();
  } catch (e) {
    const reason = `go-gate internal error, failing closed: ${String(e?.message || e).slice(0, 200)}`;
    console.log(JSON.stringify({ decision: "deny", reason: `[MECHANICAL GO-GATE BLOCKED] ${reason}` }));
    process.stderr.write(`Blocked by go-gate hook: ${reason}\n`);
    process.exit(2);
  }
}

// Run as a hook (node go-gate.mjs); importing it (bin/aos-acp.mjs) must not.
const invokedAs = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (invokedAs === fileURLToPath(import.meta.url)) safeMain();
