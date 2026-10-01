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

import { readFileSync, writeFileSync, existsSync, unlinkSync, realpathSync, mkdirSync, renameSync, appendFileSync, readdirSync, openSync, readSync, closeSync, fstatSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Command start: line/separator/subshell start, then optional wrappers (sudo/env/command/
// builtin/exec/nohup/time/xargs/eval with options, `bash -c`, VAR=x), an optional opening
// quote (bash -c 'git push') and an optional directory (/usr/bin/git). The regexes are the
// fast first line; the token classifier below (classify + the catch-all) is the authority.
const WRAP = String.raw`(?:(?:sudo|env|command|builtin|exec|nohup|time|xargs|eval|then|do|else)(?:\s+-{1,2}[\w-]+(?:=\S*)?(?:\s+(?![-'"])(?!(?:\S*/)?(?:git|gh|npm|rm|opencode|curl|wget)\b)[^\s;&|'"]+)?)*\s+|(?:bash|sh|zsh|dash|ksh)(?:\s+-\w+)*\s+-c\s+|\w+=\S*\s+)*`;
const A = String.raw`(?:^|[;&|\n({\x60])\s*${WRAP}['"]?(?:[^\s;&|()'"]*/)?`;
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
  re(String.raw`opencode\s+attach\b`),
  /\/session\/[^\s/'"]+\/(?:message|prompt_async|command|shell)\b/i,
  /\/\/[^\s'"]*\/tui\/|\/tui\/(?:append|submit|clear|execute|open|show|publish|control)/i,
];

// ---------------------------------------------------------------------------
// Scopes: each guarded command segment maps to the grant scope(s) it needs.
// ---------------------------------------------------------------------------
export const SCOPES = ["push-feature", "push-main", "merge", "publish", "destructive", "github-write"];

// Output redirections (`2>&1`, `>/dev/null`, `&>log`) are removed before splitting, so the
// `&` in `2>&1` is not a separator and `git push origin a:a 2>&1` reads as a plain push.
// Process substitutions `>(`/`<(` are kept (the `(` splits them into their own segment).
const REDIR = /\d*>&\d+|&>>?\s*[^\s(;&|]+|\d*>>?\s*[^\s(;&|]+/g;
const segments = (cmd) => String(cmd).replace(REDIR, " ").split(/&&|\|\||\$\(|[;&|\n(){}\x60]/).map((s) => s.trim()).filter(Boolean);
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
  xargs: { v: /^-[IPndLsEa]$/ }, script: { v: /^-[Ft]$/, pos: 1 }, then: {}, do: {}, else: {},
};
const SHELLS = /^(?:bash|sh|zsh|dash|ksh|eval|watch|parallel)$/;

// Strips `!`, VAR=x and wrappers. `opaque`: the real command text is hidden (sh -c, eval,
// watch, env -S, linux `script -c`, xargs input); `gitEnv`: a GIT_* variable is set.
function stripPrefix(tok) {
  let i = 0, opaque = false, gitEnv = false;
  for (;;) {
    const t = unq(tok[i] ?? "");
    if (t === "!") { i++; continue; }
    if (/^\w+=/.test(t)) { gitEnv ||= /^GIT_/.test(t); i++; continue; }
    const w = WRAPPERS[base(tok[i] ?? "")];
    if (!w) break;
    const name = base(tok[i]);
    i++;
    let pos = w.pos || 0;
    while (i < tok.length) {
      const o = unq(tok[i]);
      if (name === "env" && /^\w+=/.test(o)) { gitEnv ||= /^GIT_/.test(o); i++; continue; }
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
export const FALLBACK_PROTECTED = ["main", "master", "develop", "trunk", "production", "release", "release-*"];
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
        if (/^[A-Za-z0-9._/-]+$/.test(head)) list = ["main", "master", head];
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
function pushScopes(args, unsafe, protectedFor) {
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
  if (!remote || !SAFE_NAME.test(remote) || !refs.length) main = true; // bare push: current branch and refmap unknown
  const prot = protectedFor(remote || "");
  for (const r of refs) {
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
  if (opaque) return catchAll(tok, seg, true) ? null : [];
  if (cmd === "git" || cmd === "hub") {
    let i = 1, config = false;
    for (;;) {
      const t = unq(tok[i] ?? "");
      if (GIT_VALUE_OPTS.test(t)) { config ||= /^(?:-c|--config-env)$/.test(t); i += 2; }
      else if (/^(?:-[cC].|--[\w-]+=)/.test(t)) { config ||= /^(?:-c.|--config-env=)/.test(t); i++; }
      else if (GIT_FLAG_OPTS.test(t)) i++;
      else if (t.startsWith("-")) return catchAll(tok, seg) ? null : []; // unknown global option
      else break;
    }
    const sub = unq(tok[i]), r = tok.slice(i + 1).map(unq);
    if (sub === "push") {
      const unsafe = config || gitEnv || /[<'"$\x60\\*?{}[\]~^]/.test(tok.slice(i).join(" "));
      return pushScopes(r, unsafe, protectedFor);
    }
    if (sub === "reset" && r.includes("--hard")) return ["destructive"];
    if (sub === "clean" && r.some((t) => /^-[a-zA-Z]*f/.test(t) || t === "--force")) return ["destructive"];
    if (sub === "branch") {
      const del = r.some((t) => /^-[a-zA-Z]*D/.test(t) || /^-[a-zA-Z]*(?:df|fd)/.test(t)) ||
        (r.some((t) => t === "--delete" || /^-[a-ce-zA-Z]*d[a-zA-Z]*$/.test(t)) && r.some((t) => t === "--force" || /^-[a-eg-zA-Z]*f[a-zA-Z]*$/.test(t)));
      return del ? ["destructive"] : [];
    }
    if (sub === "worktree" && r[0] === "remove") return ["destructive"];
    if (sub === "config" && r.some((t) => PUSHY_CONFIG.test(t))) return null;
    return [];
  }
  if (PM.test(cmd) || cmd === "npx") {
    if (cmd === "npx") return catchAll(tok, seg) ? null : [];
    let i = 1;
    while (unq(tok[i] ?? "").startsWith("-")) i += NPM_VALUE_OPTS.test(unq(tok[i])) ? 2 : 1;
    const sub = unq(tok[i]), next = unq(tok[i + 1]);
    if (/^(?:publish|version)$/.test(sub) || (cmd === "yarn" && sub === "npm" && next === "publish")) return ["publish"];
    return catchAll(tok, seg) ? null : [];
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
      if (/(?:^|\s)(?:-X\s*|--method[\s=]+)(?:POST|PATCH|PUT|DELETE)\b/i.test(s) || /(?:^|\s)(?:-[fF]|--field|--raw-field|--input)/.test(s)) return ["github-write"];
    }
    return [];
  }
  if (/^(?:push|publish)$/.test(cmd)) return null; // the program name was computed: `$(echo git) push`
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
    if ((PM.test(w[i]) || w[i] === "npx") && after(i, /^(?:publish|version)$/)) return true;
    if (w[i] === "gh" && after(i, /^(?:merge|create|delete|edit|comment|close|review|api)$/)) return true;
    if (/^(?:np|release-it|semantic-release)$/.test(w[i]) || (w[i] === "changeset" && after(i, /^publish$/))) return true;
    if (w[i] === "rm" && w.slice(i + 1).some((x) => /^-[a-zA-Z]*[rR]/.test(x) || x === "--recursive")) return true;
  }
  return false;
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

export function commandScopes(command, protectedFor = staticResolver) {
  const out = new Set();
  const segs = segments(command);
  if (feedsShell(segs) && catchAll(tokens(String(command)), "", true)) return null;
  for (const seg of segs) {
    const s = classify(seg, protectedFor);
    if (s === null) return null;
    if (!s.length && GUARDED_PATTERNS.some((r) => r.test(seg))) return null;
    s.forEach((x) => out.add(x));
  }
  if (!out.size && GUARDED_PATTERNS.some((r) => r.test(String(command)))) return null;
  if (out.size && UNSAFE_COMPOUND.test(String(command))) return null;
  return [...out];
}

export const isGuardedCommand = (command) =>
  typeof command === "string" && (GUARDED_PATTERNS.some((r) => r.test(command)) || (commandScopes(command) ?? [1]).length > 0);

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
  if (!STORE_REF.test(norm)) return null;
  // `>` covers redirects and `>(`; `<(` and `$(`/backticks run commands of their own.
  const readOnly = !/[>\x60]|\$\(|<\(/.test(norm) &&
    norm.split(/&&|\|\||[;|&\n]/).every((s) => /^\s*(?:cat|ls|grep|head|tail)\b/.test(s));
  return readOnly ? null : "Blocked by go-gate: the GO/grant store (~/.aos/gate, ~/.aos/go) is written only by the AOS hooks. Grants come from the human typing `gogate grant ...`; read-only cat/ls/grep/head/tail is allowed.";
}

// Unreadable stdin throws: safeMain denies (exit 2) instead of allowing with empty input.
function readStdin() {
  return readFileSync(0, "utf8");
}

function respond(isAgy, allowed, reason = "", command = "") {
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
      if (!line.includes("gogate") || !line.includes('"user"')) continue;
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
const TOKEN_TTL_MS = 10 * 60 * 1000;

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

  const command =
    input?.toolCall?.args?.CommandLine ||
    input?.toolCall?.args?.command ||
    input?.tool_input?.command ||
    input?.command ||
    "";

  if (typeof command !== "string" || !command.trim()) {
    respond(isAgy, true);
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

  // Modes and grants exist only where go-grant.mjs runs (Claude Code: session_id present).
  const key = !isAgy && input.session_id ? sessionKey(input.session_id) : "";
  if (key) {
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
