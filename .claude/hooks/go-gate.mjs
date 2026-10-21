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

import { constants as FS, readFileSync, writeFileSync, existsSync, unlinkSync, realpathSync, mkdirSync, renameSync, appendFileSync, readdirSync, openSync, readSync, closeSync, fstatSync, statSync, lstatSync, opendirSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID, createPublicKey, verify as cryptoVerify, timingSafeEqual } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join, resolve, dirname, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
// A missing sibling must read as strict, never crash the hook (a crash exits 1 and the harness runs the command).
let profileFor = () => ({ profile: "strict" });
try { ({ profileFor } = await import("./gate-profile.mjs")); } catch { /* strict */ }

// Command start: line/separator/subshell start, then optional wrappers (sudo/env/command/
// builtin/exec/nohup/time/xargs/eval with options, `bash -c`, VAR=x), an optional opening
// quote (bash -c 'git push') and an optional directory (/usr/bin/git). The regexes are the
// fast first line; the token classifier below (classify + the catch-all) is the authority.
const WRAP = String.raw`(?:(?:sudo|env|command|builtin|exec|nohup|time|xargs|eval|then|do|else|until|while|if|elif)(?:\s+-{1,2}[\w-]+(?:=\S*)?(?:\s+(?![-'"])(?!(?:\S*/|=)?(?:git|gh|npm|rm|opencode|curl|wget)\b)[^\s;&|'"]+)?)*\s+|(?:bash|sh|zsh|dash|ksh)(?:\s+-\w+)*\s+-c\s+|\w+=\S*\s+)*`;
const A = String.raw`(?:^|[;&|\n({\x60])\s*${WRAP}['"]?(?:=|[^\s;&|()'"]{0,128}/)?`;
// git / gh with global options before the subcommand (plain `git <sub>` is spelled out too).
const G = String.raw`git(?:\s+(?:-[cC]\s*(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?))+\s+`;
const GH = String.raw`gh(?:\s+(?:-R|--repo)(?:\s+|=)\S+)+\s+`;
const S = String.raw`[^;&|\n]*`;
const prefixes = (w, min) => Array.from({ length: w.length - min + 1 }, (_, i) => w.slice(0, min + i));
// PowerShell accepts any unique prefix of a parameter name: -e/-en/.../-encodedcommand, -ec, -encodeda.../-encodedarguments.
const PS_ENC = [...prefixes("encodedcommand", 1), "ec", ...prefixes("encodedarguments", 8)].join("|");
const PS_CMD = prefixes("command", 1).join("|");
const re = (s, f = "i") => new RegExp(A + s, f);

// The aos-gate token anywhere in the command (node/npx/env/bash -c wrappers, any path); grant, work and every profile but strict widen the gate. strict and revoke only narrow it.
export const GATE_WIDEN = new RegExp(String.raw`(?:^|[\s\/\\'"=;&|(\x60])aos-gate(?:\.mjs)?['"]?\s+(?:grant|work|profile(?!\s+['"]?strict\b))\b`, "i");
// A command no profile and no global grant may free: only a typed GO (or a human-typed gogate grant) opens it.
export const neverGrantable = (command) => typeof command === "string" && [command, unIFS(command), unIFS(commandView(command).text)].some((t) => GATE_WIDEN.test(t));

// PowerShell: running a string as code, or a state-changing web request, is a plain GO (a plain GET stays free, see psReadOnly).
const PS_GUARDED = [
  re(String.raw`(?:^|[\s;|({"'])(?:iex|Invoke-Expression)(?=[\s;|)}'"]|$)`),
  re(String.raw`\b(?:Invoke-(?:WebRequest|RestMethod)|iwr|irm)\b[^;|\n]*?\s-m\w*[\s:=]+['"]?(?:POST|PUT|DELETE|PATCH)\b`),
];

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
  ...PS_GUARDED,
  // A base64 PowerShell command cannot be read at all. No scope: a plain GO.
  re(String.raw`(?:powershell|pwsh)(?:\.exe)?['"]?${S}\s-(?:${PS_ENC})\b`),
  // The AOS uninstaller deletes through Node's rmSync, which the rm analysis never sees. No scope: a plain GO.
  re(String.raw`(?:(?:npx|bunx|pnpx)\s+(?:-{1,2}[\w-]+(?:[\s=]+\S+)?\s+)*|node(?:js)?\s+)?(?:\S*/)?aos-uninstall(?:\.mjs)?\b(?!${S}\s--dry-run(?=\s|$))`),
  re(String.raw`(?:gh\s+|${GH})api\b${S}\s(?:-[fF]|--field|--raw-field|--input)`, ""),
  // `git -c alias.x=push x`: a one-off alias hides the subcommand (a persisted `git config alias` cannot be seen here).
  re(String.raw`git\s+(?:-[cC]\s*\S+\s+)*-c\s*['"]?alias\.`),
  // Widening the gate profile or adding a global grant: never grantable, always a plain GO (see neverGrantable).
  GATE_WIDEN,
  // Never grantable (no scope), always a plain GO: driving another OpenCode session
  // (resume/attach, or the server's HTTP API) can type text that looks human there.
  // The HTTP paths are matched anywhere in the command, independent of host spelling
  // (127.1, [::ffff:...], $(hostname), unix socket, fetch() inside node -e).
  // Residual risk: keystrokes into a resumed TUI (tmux send-keys, osascript) look exactly
  // like a human typing and cannot be told apart by any hook.
  re(String.raw`opencode\s+run\b${S}\s(?:-[a-zA-Z]*[sc]\S*|--session|--continue)(?=[\s=]|$)`, ""),
  re(String.raw`claude\b${S}\s(?:-[a-zA-Z]*[cr]\S*|--resume|--continue)(?=[\s=]|$)`, ""),
  re(String.raw`opencode\s+attach\b`),
  re(String.raw`opencode\s+run\b[^;|\n]*\s--attach\b`),
  /\/session\/[^\s/'"]+\/(?:message|prompt_async|command|shell)\b/i,
  /\/\/[^\s'"]*\/tui\/|\/tui\/(?:append|submit|clear|execute|open|show|publish|control)/i,
];

// The two OpenCode HTTP-API patterns also apply to interpreter code (fetch() inside node).
export const HTTP_PATTERNS = GUARDED_PATTERNS.slice(-2);

// Routes by which an agent can post a prompt that looks human; `gogate off` never lifts these (OpenCode plugin).
const OC_ROUTE_PATTERNS = GUARDED_PATTERNS.slice(-6);

// Content-independent cover for the same self-unlock: any network client talking to the OpenCode server's own port on
// loopback is guarded whatever the path (globs, braces, variables, quote splits and concatenation defeat a path regex).
// Only a provable plain GET stays free. Ports: 4096 (default), the plugin's serverUrl and a --port of this process.
const ocPorts = new Set(["4096"]);
export function setOpencodeServer(url) {
  try { const p = new URL(String(url)).port; if (/^\d{1,5}$/.test(p)) ocPorts.add(p); } catch { /* no usable url */ }
}
const NET_CLIENT = /(?:^|[\s;&|(`'"{])(?:curl|wget|http|https|xh|nc|ncat|netcat|socat|telnet|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)(?:\.exe)?(?=[\s'"])/i;
const NET_CODE = /\b(?:fetch\s*\(|XMLHttpRequest|http\.request|https?\.(?:get|request)|urllib|requests\.|httpx|aiohttp|socket|net\.(?:connect|Socket|createConnection)|Net::HTTP|open-uri|URI\.open|WebClient|curl_)/;
const LOOPBACK = /127(?:\.\d{1,3}){0,3}|localhost|::1|0\.0\.0\.0|0x7f[0-9a-f]*|2130706433|::ffff:/i;
export function opencodeSelfPost(command) {
  if (typeof command !== "string") return false;
  const t = normDash(command);
  const flat = t.replace(/["'\\]/g, ""), joined = flat.replace(/[+\s]+/g, "");
  const client = NET_CLIENT.test(t) || NET_CODE.test(t);
  if (!client) return false;
  const ports = [...ocPorts].join("|");
  const portHit = (x) => new RegExp(`(?<!\\d)(?:${ports})(?!\\d)`).test(x);
  const loop = [t, flat, joined].some((x) => LOOPBACK.test(x));
  const foreign = /https?:\/\/(?!(?:127|localhost|\[?::1|0\.0\.0\.0))[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i.test(flat);
  // a computed port or host next to a loopback host, or a computed URL: cannot be resolved here
  const computed = /(?:127(?:\.\d+){0,3}|localhost|::1|0\.0\.0\.0)[^\s/]*:(?:\d*[$`{\[(]|[^\s/]*[$`{\[(])|https?:\/\/[^\s/]*[$`{\[(]/i.test(flat);
  if (!([t, flat, joined].some(portHit) && (loop || !foreign)) && !computed) return false;
  // provably plain GET: curl/wget without a body or method, a PowerShell GET; code, nc, socat, telnet never
  if (!NET_CODE.test(t) && /(?:^|[\s;&|(`'"{])(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|http)(?:\.exe)?\s/i.test(t) && !/(?:^|[\s;&|(`'"{])(?:nc|ncat|netcat|socat|telnet)\s/i.test(t)) {
    const body = /(?:^|\s)(?:-[a-zA-Z]*[dFTX]|--(?:data[\w-]*|form[\w-]*|upload-file|json|request|post-\w+|body-\w+|method)|-Method|-Body|-Form|-InFile)(?=[\s=:]|$)/i.test(flat);
    const method = /(?:-X\s*|--request[\s=]+|--method[\s=]+|-Method[\s:=]+)(?!(?:GET|HEAD)\b)\S/i.test(flat);
    if (!body && !method && !computed && !/@\w/.test(flat)) return false;
  }
  return true;
}
export const opencodeRoute = (command) => typeof command === "string" && (opencodeSelfPost(command) || [command, unIFS(command), unIFS(commandView(command).text)].some((t) => OC_ROUTE_PATTERNS.some((r) => r.test(t))));

// ---------------------------------------------------------------------------
// Scopes: each guarded command segment maps to the grant scope(s) it needs.
// ---------------------------------------------------------------------------
export const SCOPES = ["push-feature", "push-main", "merge", "publish", "destructive", "github-write", "container-test", "workspace"];

// Output redirections (`2>&1`, `>/dev/null`, `&>log`) are removed before splitting, so the
// `&` in `2>&1` is not a separator and `git push origin a:a 2>&1` reads as a plain push.
// Process substitutions `>(`/`<(` are kept (the `(` splits them into their own segment).
// `${IFS}`/`$IFS` (gatefix4 4) reads as a space before judging; the default IFS is exactly
// that, and an unquoted expansion is word-split, so a glued `git${IFS}push` body must be
// judged as the push it becomes (a quoted body loses only this, never more: fail closed).
const UNIFS = /\$\{IFS\}|\$IFS/g;
const unIFS = (s) => String(s).replace(UNIFS, " ");
const REDIR = /\d*>&\d+|&>>?\s*[^\s(;&|]+|\d*>>?\s*[^\s(;&|]+/g;
// A lone `&` inside quotes or after a backslash (`cd "/tmp/a & b"`, `a\&b`) is text, not a control operator.
const AMP = "\u000e";
function maskQuotedAmp(s) {
  let out = "", q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && q !== "'") { const n = s[i + 1] ?? ""; out += c + (n === "&" ? AMP : n); i++; continue; }
    if (q) {
      if (c === q) q = "";
      out += c === "&" && s[i - 1] !== "&" && s[i + 1] !== "&" && s[i - 1] !== ">" && s[i + 1] !== ">" ? AMP : c;
      continue;
    }
    if (c === "'" || c === '"') q = c;
    out += c;
  }
  return out;
}
const unmaskAmp = (s) => s.replaceAll(AMP, "&");
const segments = (cmd) => maskQuotedAmp(unIFS(commandView(cmd).text)).replace(REDIR, " ").split(/&&|\|\||\$\(|[;&|\n(){}\x60]/).map((s) => unmaskAmp(s.trim())).filter(Boolean);
// Tokens keep quoted parts glued to their word; unq() gives the shell value (quotes and
// backslashes removed: `g\it`, `'git'`, `"push"` are git and push to the shell too).
const tokens = (s) => s.match(/(?:"[^"]*"|'[^']*'|[^\s"']+)+/g) || [];
// (H7d) a `$` directly in front of a quote (`$'rm'`, `$"git"`) is ANSI-C/locale quoting: the shell value has no `$`.
// (H7f) the body of `$'..'` is decoded (`$'\x72m'` is rm).
const ANSI_ESC = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", E: "\x1b", f: "\f", v: "\v" };
const ansiC = (b) => b.replace(/\\(?:x([0-9a-fA-F]{1,2})|([0-7]{1,3})|[uU]([0-9a-fA-F]{1,8})|([\s\S]))/g, (m, x, o, u, c) => {
  const n = x !== undefined ? parseInt(x, 16) : o !== undefined ? parseInt(o, 8) : u !== undefined ? parseInt(u, 16) : -1;
  return n < 0 ? ANSI_ESC[c] ?? c : n > 0x10ffff ? "" : String.fromCodePoint(n);
});
const unq = (t) => String(t ?? "").replace(/\$'((?:[^'\\]|\\[\s\S])*)'|\$(?=["'])|["'\\]/g, (m, a) => (a === undefined ? "" : ansiC(a)));
// (H7d) bash brace expansion of one unquoted word (`{git,push}`, `{push,}`); (H7f) also sequences (`{g..g}it`, `{1..3}`).
// null = more than 64 results or a word too long to expand. (H7h) One linear stack scan finds the leftmost-outermost valid
// group (own-depth comma or a valid sequence body; `${` never opens a group): an invalid inner `{}` keeps its parent, and a
// nested group is split only at the commas of its own depth, as bash does.
const SEQ = /^(?:(-?\d{1,6})\.\.(-?\d{1,6})|([A-Za-z])\.\.([A-Za-z]))(?:\.\.(-?\d{1,6}))?$/;
function braceAt(b) {
  if (!b.includes("{")) return null; // fast path: most words have no brace, and a 5000-word command pays per word
  const st = [];
  let best = null;
  for (let j = 0; j < b.length; j++) {
    const c = b[j];
    if (c === "{") st.push({ o: j, d: b[j - 1] === "$", k: [] });
    else if (c === "}") {
      const f = st.pop();
      if (f && !f.d && (best === null || f.o < best[0]) && (f.k.length || (j - f.o < 32 && SEQ.test(b.slice(f.o + 1, j))))) best = [f.o, j, f.k];
    } else if (c === "," && st.length) st[st.length - 1].k.push(j);
  }
  return best;
}
const BRACE = { test: (s) => braceAt(s) !== null };
const bareOf = (w) => w.replace(/"[^"]*"|'[^']*'/g, (m) => "\u0007".repeat(m.length));
function seqParts(body) {
  const m = SEQ.exec(body);
  if (!m) return null;
  const num = m[1] !== undefined, a = num ? +m[1] : m[3].charCodeAt(0), z = num ? +m[2] : m[4].charCodeAt(0), step = Math.abs(+m[5]) || 1;
  if (Math.floor(Math.abs(z - a) / step) >= 64) return null;
  const out = [], d = z >= a ? step : -step;
  for (let v = a; d > 0 ? v <= z : v >= z; v += d) out.push(num ? String(v) : String.fromCharCode(v));
  return out;
}
function expandBrace(w) {
  if (!w.includes("{")) return [w];
  if (w.length > 4096) return braceAt(bareOf(w)) ? null : [w];
  const out = [w];
  for (let k = 0, it = 0; k < out.length;) {
    tick();
    if (out.length > 64 || ++it > 256) return null;
    const x = out[k], b = bareOf(x), m = braceAt(b);
    if (!m) { k++; continue; }
    const [s, e, cm] = m;
    let parts = [];
    if (cm.length) {
      for (let j = 0, from = s + 1; j <= cm.length; j++) { const q = j < cm.length ? cm[j] : e; parts.push(x.slice(from, q)); from = q + 1; }
    } else if (!(parts = seqParts(b.slice(s + 1, e)))) return null;
    out.splice(k, 1, ...parts.map((q) => x.slice(0, s) + q + x.slice(e + 1)));
  }
  return out;
}
const braceRow = (tk) => !tk.some((t) => t.includes("{")) ? tk : tk.flatMap((t) => expandBrace(t) ?? [t]);
// (H7d) a command word that is itself a glob (`/usr/bin/?it`, `[g]it`) names a program the gate cannot read; `[` and `[[` are the test builtins.
const globHead = (w) => /[?*\[]/.test(w) && !/^\[\[?$/.test(w);
const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\[!/g, "[^").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
// (H7f) zsh `=git` expands to the program path: the word names git (`FOO=bar` and `a=b` are not affected).
const base = (t) => unq(t).replace(/^=(?=[A-Za-z][^=]*$)/, "").replace(/^.*\//, "");

// Transparent prefixes: the command after them is what runs. `v` = options taking a value,
// `pos` = positional arguments of the wrapper itself (timeout DURATION, script FILE).
const WRAPPERS = {
  sudo: { v: /^-[ugCDhpRrTUt]$/ }, doas: { v: /^-[uC]$/ }, env: { v: /^-[uCS]$/ }, command: {}, builtin: {}, exec: { v: /^-a$/ },
  nohup: {}, time: {}, nice: { v: /^-n$|^--adjustment$/ }, timeout: { v: /^-[sk]$/, pos: 1 }, caffeinate: { v: /^-[tw]$/ }, stdbuf: { v: /^-[ioe]$/ },
  // Process-hiding wrappers whose command is behind their own arguments too
  // (`flock /tmp/l $g push`, `ionice $g push`, `setsid $g push`).
  // (H7d) arch/xcrun run the command behind their own options.
  arch: { v: /^-arch$/ }, xcrun: { v: /^-{1,2}(?:sdk|toolchain)$/ },
  setsid: {}, flock: { pos: 1, v: /^-[wETsu]$/ }, ionice: { v: /^-[nc]$/ },
  // Loop and condition keywords run the command after them (aos-22: `until npm view ...; do ...; done`).
  xargs: { v: /^-[^IPndLsEaJ-]*[IPndLsEaJ]$|^--(?:max-args|max-procs|max-lines|max-chars|delimiter|arg-file|eof|process-slot-var)$/ }, script: { v: /^-[Ft]$/, pos: 1 }, then: {}, do: {}, else: {}, until: {}, while: {}, if: {}, elif: {},
};
const SHELLS = /^(?:bash|sh|zsh|dash|ksh|eval|watch|parallel)$/;

// Strips `!`, VAR=x and wrappers. `opaque`: the real command text is hidden (sh -c, eval,
// watch, env -S, linux `script -c`, xargs input); `gitEnv`: a GIT_* variable is set.
function stripPrefix(tok) {
  let i = 0, opaque = false, gitEnv = false, xargs = false, xargsReplace = false;
  for (;;) {
    const t = unq(tok[i] ?? "");
    if (t === "!") { i++; continue; }
    if (/^\w+=/.test(t)) { gitEnv ||= /^(?:GIT_|HOME=|XDG_CONFIG_HOME=|HUSKY=|LEFTHOOK=|SKIP=|PRE_COMMIT)/.test(t); i++; continue; }
    const w = WRAPPERS[base(tok[i] ?? "")];
    if (!w) break;
    const name = base(tok[i]);
    i++;
    let pos = w.pos || 0;
    while (i < tok.length) {
      const o = unq(tok[i]);
      if (name === "env" && /^\w+=/.test(o)) { gitEnv ||= /^(?:GIT_|HOME=|XDG_CONFIG_HOME=|HUSKY=|LEFTHOOK=|SKIP=|PRE_COMMIT)/.test(o); i++; continue; }
      if (name === "xargs" && /^-[0-9prtxovV]*[iIJ]|^--replace/.test(o)) xargsReplace = true;
      if (o.startsWith("-") && o !== "-") {
        // env -S / --split-string and flock/script -c take a command STRING as their value
        // (7, 8): the value is opaque shell text and must be judged, not skipped. A glued
        // value is rewound into a quoted token of its own; a separate value token simply
        // stays first in the token row (the shell rules and innerText read it from there).
        if ((name === "env" && /^(?:-[i0v]*S|--split-string)/.test(o)) || ((name === "flock" || name === "script") && /^(?:-[a-zA-Z]*c|--command(?:=|$))/.test(o))) {
          opaque = true;
          pos = 0; // the command string replaces script's FILE positional; it must not be skipped as one
          const raw = tok[i];
          // (H5) -S bundled (`-vS`) or quoted (`"-S"'...'`): the unquoted word carries the body.
          const m = name === "env"
            ? /^-[i0v]*S(.+)$/s.exec(raw) ?? /^--split-string=(.+)$/s.exec(raw) ?? /^-[i0v]*S(.+)$/s.exec(o) ?? /^--split-string=(.+)$/s.exec(o)
            : /^-[a-zA-Z]*c(.+)$/s.exec(raw) ?? /^--command=(.+)$/s.exec(raw) ?? /^-[a-zA-Z]*c(.+)$/s.exec(o) ?? /^--command=(.+)$/s.exec(o);
          // glued value: the rewritten token IS the body and stays first in the row;
          // separate value: skip the flag alone, the body follows as the next token.
          if (m && m[1]) { tok[i] = m[1]; continue; }
          i++;
          continue;
        }
        i += w.v?.test(o) ? 2 : 1;
        continue;
      }
      if (pos > 0) { pos--; i++; continue; }
      break;
    }
    if (name === "xargs") { opaque = true; xargs = true; }
  }
  const head = base(tok[i] ?? "");
  if (SHELLS.test(head)) opaque = true;
  return { rest: tok.slice(i), opaque, gitEnv, xargs, xargsReplace };
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
// Per-segment state handed to classify by scopesOf: the working directory (null = unknown) and
// whether an earlier segment of the same command may have changed the repository state.
let segCwd = "", segTaint = false, segFeed = "", segNoCd = false;
// Git lookups are memoised for one hook invocation (setGateContext clears them), and every
// analysis runs under a wall-clock budget: past it the command is unscoped (guarded, GO needed).
let memo = new Map();
const BUDGET = Symbol("budget");
// The budget counts this process's CPU time, not the wall clock: on a loaded machine (several sessions, Docker, test
// runs) a wall-clock budget made the first analysis of an ordinary command overrun and turn "unscoped" at random, so a
// container-test grant covered one run and not the next. A wall-clock ceiling stays as the backstop against a hang.
let deadline = 0, wallDeadline = 0;
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const tick = () => { if (deadline && (cpuMs() > deadline || Date.now() > wallDeadline)) throw BUDGET; };
// Windows: a cold process spends more CPU on its first analysis than the POSIX budget allows (measured: 500 ms suffices).
export const defaultBudgetMs = (platform = process.platform) => (platform === "win32" ? 500 : 150);
function withBudget(fn, onExceed) {
  const outer = deadline, outerWall = wallDeadline;
  if (!outer) {
    const ms = gateCtx.budgetMs ?? defaultBudgetMs();
    deadline = cpuMs() + ms;
    wallDeadline = Date.now() + (ms <= 0 ? ms : Math.max(ms * 20, 3000));
  }
  try { return fn(); } catch (e) { if (e === BUDGET) return onExceed; throw e; } finally { deadline = outer; wallDeadline = outerWall; }
}
const GIT_BUILTINS = /^(?:add|am|apply|archive|bisect|blame|branch|bundle|cat-file|check-ref-format|checkout|cherry|cherry-pick|clean|clone|commit|commit-tree|config|count-objects|credential|describe|diff|diff-files|diff-index|diff-tree|difftool|fast-export|fast-import|fetch|filter-branch|for-each-ref|format-patch|fsck|gc|grep|hash-object|help|init|log|ls-files|ls-remote|ls-tree|maintenance|merge|merge-base|mergetool|mv|name-rev|notes|pack-refs|prune|pull|push|range-diff|rebase|reflog|remote|repack|request-pull|reset|restore|rev-list|rev-parse|revert|rm|send-email|shortlog|show|show-ref|sparse-checkout|stash|status|stripspace|submodule|subtree|switch|symbolic-ref|tag|unpack-file|update-ref|var|version|whatchanged|worktree|write-tree)$/;
// A directory named by `cd` / `git -C`: null when it cannot be resolved (variable, backtick, ~user,
// `-`, or it does not exist), which callers treat as an unknown repository.
function resolveDir(base, raw) {
  const t = expandHome(unq(raw));
  if (base === null || /[$`\u0001\u0002]|^~[^/]|^-$/.test(t)) return null;
  const p = resolve(expandHome(base), t === "" ? "." : t);
  try { return statSync(p).isDirectory() ? p : null; } catch { return null; }
}
// { gitdir, common } of the repository containing `dir` (a .git directory, or a linked
// worktree's .git file -> gitdir -> commondir), found without spawning git. null = none.
function locateGit(dir) {
  const k = `loc\0${dir}`;
  if (!memo.has(k)) memo.set(k, locateGit0(dir));
  return memo.get(k);
}
function locateGit0(dir) {
  try {
    let d = resolve(dir);
    for (let k = 0; k < 64; k++) {
      let gitdir = null;
      try {
        const g = join(d, ".git"), st = statSync(g);
        if (st.isDirectory()) gitdir = g;
        else if (st.isFile() && st.size < 4096) {
          const m = /^gitdir:\s*(.+)$/m.exec(readSmallRegular(g, 4095, true) || "");
          if (m) gitdir = resolve(d, m[1].trim());
        }
      } catch { /* no .git here */ }
      if (gitdir) {
        let common = gitdir;
        try { common = resolve(gitdir, mustRead(join(gitdir, "commondir"), 64 * 1024).trim()); } catch { /* not a linked worktree */ }
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
    const head = (readSmallRegular(f, 4095, true) || "").trim();
    const b = /^ref:\s*refs\/heads\/(\S+)$/.exec(head)?.[1];
    return b && SAFE_NAME.test(b) ? b : null;
  } catch { return null; }
}

// Minimal git config reader: system, XDG, ~/.gitconfig (the OS user's real home, injectable via
// setGateContext({realHome})), the repo's config (the common dir for a linked worktree) and
// config.worktree when extensions.worktreeConfig is on. Any include/includeIf, unreadable or
// oversized file, or a GIT_* variable that redirects git makes it null: callers then fail closed.
const GIT_REDIRECT = /^(?:GIT_DIR|GIT_COMMON_DIR|GIT_WORK_TREE|GIT_CONFIG(?!_NOSYSTEM$)\w*|GIT_INDEX_FILE|GIT_NAMESPACE)$/;
// A value ends at the first unquoted # or ; (linear scan; no regex over user-sized text).
function configValue(v) {
  let q = false, end = v.length;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c === "\\") { i++; continue; }
    if (c === '"') q = !q;
    else if (!q && (c === "#" || c === ";")) { end = i; break; }
  }
  const s = v.slice(0, end).trim();
  return s.length > 1 && s[0] === '"' && s.at(-1) === '"' ? s.slice(1, -1) : s;
}
function parseGitConfig(text, out) {
  let section = "", sub = null;
  for (let line of text.split("\n")) {
    tick();
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
    const eq = line.indexOf("=");
    const key = (eq === -1 ? line : line.slice(0, eq)).trim();
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key)) continue;
    out.push({ s: section, sub, k: key.toLowerCase(), v: eq === -1 ? "true" : configValue(line.slice(eq + 1)) });
  }
  return true;
}
export function gitConfig(repoDir) {
  const k = `cfg\0${repoDir}`;
  if (!memo.has(k)) memo.set(k, gitConfig0(repoDir));
  return memo.get(k);
}
// Only a regular file is read, bounded to 256 KB: a FIFO, device or directory is unreadable and
// fails closed; a missing file is fine.
function readConfigFile(f) {
  let st;
  try { st = statSync(f); } catch (e) { return e?.code === "ENOENT" || e?.code === "ENOTDIR" ? "" : null; }
  if (!st.isFile() || st.size > 256 * 1024) return null;
  const text = readSmallRegular(f, 256 * 1024, true);
  return typeof text === "string" ? text : null;
}
function gitConfig0(repoDir) {
  if (Object.keys(process.env).some((k) => GIT_REDIRECT.test(k))) return null;
  const loc = locateGit(repoDir);
  if (!loc) return null;
  const rh = gateCtx.realHome ?? osHome();
  const out = [];
  const readOne = (f) => {
    const text = readConfigFile(f);
    return text === null ? false : parseGitConfig(text, out);
  };
  const system = process.env.GIT_CONFIG_NOSYSTEM ? [] : ["/etc/gitconfig"];
  for (const f of [...system, join(process.env.XDG_CONFIG_HOME || join(rh, ".config"), "git", "config"), join(rh, ".gitconfig"), join(loc.common, "config")]) if (!readOne(f)) return null;
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

// A `gh api` write. Ones that move or write a protected branch are push-main: a ref update or
// create (`git/refs/heads/<b>`, `git/refs` with ref=), branch protection and rename
// (`branches/<b>/...`), `merges` (base), and `contents/<path>` PUT/DELETE (branch, default branch
// otherwise). The branch must be PROVEN non-protected (a literal in the path or in a -f/-F field);
// a placeholder, variable, missing field or --input body is push-main. Other writes: github-write.
const GH_WRITE = new Set(["POST", "PATCH", "PUT", "DELETE"]);
function ghApiScopes(args, protectedFor) {
  let method = "", input = false, endpoint = "";
  const fields = new Map();
  const addField = (kv = "") => { const i = kv.indexOf("="); if (i > 0) fields.set(kv.slice(0, i), kv.slice(i + 1)); };
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === "-X" || t === "-x" || t === "--method") method = (args[++i] ?? "").toUpperCase();
    else if (/^-[Xx]./.test(t)) method = t.slice(2).toUpperCase();
    else if (/^--method=/.test(t)) method = t.slice(9).toUpperCase();
    else if (/^(?:-f|-F|--field|--raw-field)$/.test(t)) addField(args[++i]);
    else if (/^-[fF]./.test(t)) addField(t.slice(2));
    else if (/^--(?:field|raw-field)=/.test(t)) addField(t.slice(t.indexOf("=") + 1));
    else if (t === "--input") { input = true; i++; }
    else if (/^--input=/.test(t)) input = true;
    else if (/^(?:-H|--header|-q|--jq|-t|--template|--hostname|--cache|-p|--preview)$/.test(t)) i++;
    else if (t.startsWith("-")) continue;
    else if (!endpoint) endpoint = t;
  }
  const write = GH_WRITE.has(method) || (method === "" && (fields.size > 0 || input));
  if (!write) return [];
  const ep = endpoint.replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "").replace(/[?#].*$/, "");
  // GraphQL: a mutation that moves or merges a ref, or one whose text is not readable here.
  if (/^graphql$/i.test(ep)) {
    const unreadable = input || [...fields.values()].some((v) => /^@/.test(v));
    return unreadable || /\b(?:updateRef|createRef|deleteRef|createCommitOnBranch|mergePullRequest|mergeBranch|updateBranchProtectionRule)\b/.test(args.join(" ")) ? ["push-main"] : ["github-write"];
  }
  const m = /^(?:repos\/([^/]+)\/([^/]+)|repositories\/(\d+))\/(.+)$/.exec(ep);
  // An endpoint that is not a literal repos/<o>/<r>/... path but holds a variable or substitution
  // (or is missing) can name any repository path, so a write to it is push-main.
  if (!m) return !ep || /[$`\u0001\u0002]/.test(ep) ? ["push-main"] : ["github-write"];
  if (/[$`\u0001\u0002]/.test((m[1] ?? "") + (m[2] ?? ""))) return ["push-main"];
  const p = m[4], prot = protectedFor("");
  const bad = (name) => {
    if (!name) return true;
    let n = name;
    try { n = decodeURIComponent(n); } catch { return true; }
    return /[$`{}*\\\u0004\u0005]/.test(n) || /^@/.test(n) || n.startsWith("-") || n.startsWith(".") || /^head$/i.test(n) || isProtected(n.replace(/^refs\/heads\//, ""), prot);
  };
  let q;
  if (method === "PUT" && /^pulls\/[^/]+\/merge$/.test(p)) return ["merge"];
  if ((q = /^git\/refs\/heads\/(.+)$/.exec(p))) return bad(q[1]) ? ["push-main"] : ["github-write"];
  if (/^git\/refs\/(?:tags\/.+)$/.test(p)) return ["github-write"];
  if (/^git\/refs\/?$/.test(p)) {
    const ref = fields.get("ref");
    if (ref === undefined || /^@/.test(ref)) return ["push-main"];
    if (/^refs\/tags\//.test(ref)) return ["github-write"];
    return /^refs\/heads\/./.test(ref) && !bad(ref) ? ["github-write"] : ["push-main"];
  }
  if ((q = /^branches\/([^/]+)(?:\/|$)/.exec(p))) return bad(q[1]) ? ["push-main"] : ["github-write"];
  if (p === "merges") return bad(fields.get("base")) ? ["push-main"] : ["github-write"];
  if (/^contents\/./.test(p) && (method === "PUT" || method === "DELETE")) return bad(fields.get("branch")) ? ["push-main"] : ["github-write"];
  return ["github-write"];
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
const PUSHY_CONFIG = /push|remote\.|url\.|insteadof|alias\.|hookspath|gpgsign/i;
// A commit that skips hooks or signing needs a plain GO: --no-verify (and its abbreviations), --no-gpg-sign, a -n
// bundle, a -c / --config-env key that sets core.hooksPath or commit.gpgsign (or cannot be read), a bare $word.
const COMMIT_BYPASS_FLAG = /^(?:--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?|--no-g\S*|-[a-zA-Z]*n[a-zA-Z]*)$/;
// Config keys that skip or redirect hooks, signing, the editor or helper programs; a commit may set only a few harmless ones.
const badGitKey = (v) => { const key = String(v ?? "").split("=")[0]; return /^(?:core\.(?:hookspath|editor|fsmonitor|pager|sshcommand|askpass)|commit\.gpgsign|gpg\.program|include(?:if)?\..*|credential\.helper)$/i.test(key) || /[$\x60]/.test(key); };
// A flag-shaped word that carries an expansion (`--no-v${A}`) is as unreadable as a bare `$FLAGS`.
const commitBypass = (r) => { const end = r.indexOf("--"); return r.slice(0, end === -1 ? undefined : end).some((t) => COMMIT_BYPASS_FLAG.test(t) || /^[$\x60]/.test(t) || (/^-/.test(t) && /[$\x60]/.test(t))); };
const COMMIT_WORD_BYPASS = /^(?:--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?|--no-g\S*|-[a-zA-Z]*n[a-zA-Z]*|-?c?core\.hookspath\S*|-?c?commit\.gpgsign\S*|--config-env=(?:core\.hookspath|commit\.gpgsign)\S*)$/i;
const PM = /^(?:npm|pnpm|yarn|bun)$/;
// Program heads whose real arguments xargs reads from stdin.
const XARGS_PROG = /^(?:git|hub|npm|pnpm|yarn|bun|npx|rm|gh|docker)$/;
// (gatefix4 5) for a stdin-fed xargs row a guarded subcommand must be VISIBLE: stdin can
// splice it in otherwise. git/hub: one of the git verbs; the package managers: publish or
// version; gh: one of the write verbs (a bare `gh pr` glued `merge` from stdin stays
// unscoped); docker: one of the run-like subcommands.
// (M2) a VISIBLE subcommand is what keeps a stdin-fed row judgeable: guarded or read-only, stdin
// only appends arguments to it. No visible subcommand (`xargs git --no-pager`, `xargs npm`) is unscoped.
const xargsSubVisible = (cmd, r) => {
  const w = r.map(unq);
  if (/^(?:git|hub)$/.test(cmd)) {
    let i = 0;
    while (i < w.length && w[i].startsWith("-")) i += GIT_VALUE_OPTS.test(w[i]) ? 2 : 1;
    return i < w.length;
  }
  if (PM.test(cmd)) {
    let i = 0;
    while (i < w.length && w[i].startsWith("-")) i += NPM_VALUE_OPTS.test(w[i]) ? 2 : 1;
    return i < w.length;
  }
  if (cmd === "gh") { const { a, b } = ghParts(["gh", ...r]); return !!a && !!b && !a.startsWith("-") && !b.startsWith("-") && a !== "api"; }
  if (cmd === "docker") return w.length > 0 && !w[0].startsWith("-");
  return true;
};
const PM_SAFE = /^(?:install|i|ci|add|remove|rm|uninstall|update|up|test|t|build|lint|ls|list|why|outdated|audit|info|view|init|config|cache|start|dev|pkg|help|search|whoami)$/;
const NPM_VALUE_OPTS = /^(?:--prefix|-w|--workspace|-C|--dir|--registry|--userconfig|--cache|--tag|--otp|--access|--filter|--cwd)$/;

// (H7) a word whose literal head is (a prefix of / starts with) a guarded program and that has a computed
// part after it: `gi$p`, `r${u}`, `git$p`. A pure `$X` head and unrelated heads (`echo$x`) are not meant.
const GLUED_PROGS = ["git", "hub", "npm", "pnpm", "yarn", "bun", "npx", "rm", "gh", "docker", "bash", "sh", "zsh", "dash", "ksh", "eval", "watch", "parallel"];
const gluedHead = (w) => {
  if (/^\w+=/.test(w)) return false; // (H7d) an assignment word (`git_sha=$(...)`) is not a program name
  const p = w.split(/[$`\u0001\u0002?*\[]/, 1)[0];
  return p.length > 0 && p.length < w.length && GLUED_PROGS.some((g) => g.startsWith(p) || p.startsWith(g));
};

// Precise classification of one segment: array of scopes, [] = not guarded,
// null = guarded but not classifiable (never grantable).
// PowerShell web cmdlets: a request is free only when the method is provably GET/HEAD and nothing implies a body or a file.
// A splat (`@p`), a variable method or an unknown method cannot be judged: plain GO. A known write method is github-write.
const PS_WEB = /^(?:invoke-webrequest|invoke-restmethod|iwr|irm)$/i;
function psWebScopes(args) {
  let method = null, unknown = false, write = false;
  for (let i = 0; i < args.length; i++) {
    const raw = unq(args[i]);
    if (raw.startsWith("@")) { unknown = true; continue; }
    const m = /^-([a-z]+)(?::(.*))?$/i.exec(raw);
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (name[0] === "m" && !name.startsWith("max") && "method".startsWith(name)) method = (m[2] ?? unq(args[++i] ?? "")).toLowerCase();
    else if (/^[bfio]/.test(name) && !name.startsWith("information")) write = true; // Body, Form, InFile, OutFile
  }
  if (method !== null) {
    if (/^(?:post|put|delete|patch)$/.test(method)) write = true;
    else if (!/^(?:get|head)$/.test(method)) unknown = true;
  }
  return write ? ["github-write"] : unknown ? null : [];
}

export function classify(seg, protectedFor = staticResolver) {
  const { rest: tok, opaque, gitEnv, xargs, xargsReplace } = stripPrefix(tokens(seg));
  const cmd = base(tok[0] ?? "");
  if (PS_WEB.test(cmd)) return psWebScopes(tok.slice(1));
  // xargs takes its command words from stdin (`echo push origin HEAD:main | xargs git`,
  // `echo -rf build | xargs rm`): when NO argument of its own is visible after the guarded
  // program the whole guarded word is stdin-fed and the segment is unscoped. An rm row that
  // SHOWS its own recursive flag (`xargs rm -rf`) is judged as before (destructive, the
  // visible word row is the truth); an rm row without one is unscoped, because its flags can
  // come from the stdin words (`echo -rf build | xargs rm`), the old bare `rm -rf` row.
  // (5) -I/-J/--replace splices the stdin words anywhere (flags, subcommand): always
  // unscoped. And with a guarded program head a guarded subcommand must be visible —
  // `echo push origin HEAD:main | xargs git --no-pager` assembles it from stdin.
  // (H3) `git$p origin ...`: a `$` glued inside a guarded-program-prefixed head word is computed.
  // (H7) a head glued from a guarded-program prefix and a computed part (`gi$p push`, `r$p -rf x`); a pure `$X` head stays free here (catchAll judges it).
  if (!opaque && gluedHead(cmd)) return null;
  if (xargs && XARGS_PROG.test(cmd)) {
    if (xargsReplace) return null;
    if (!tok.slice(1).length) return null;
    if (!(cmd === "rm" || cmd === "rmx") && !xargsSubVisible(cmd, tok.slice(1))) return null;
    if (PM.test(cmd)) {
      const w = tok.slice(1).map(unq);
      let i = 0;
      while (i < w.length && w[i].startsWith("-")) i += NPM_VALUE_OPTS.test(w[i]) ? 2 : 1;
      if (/^(?:publish|version)$/.test(w[i] ?? "") && !w.some((t) => /[$`\u0001\u0002]/.test(t))) return ["publish"];
    }
  }
  if (xargs && (cmd === "rm" || cmd === "rmx")) {
    if (tok.slice(1).some((t) => /^-[a-zA-Z]*[rR]/.test(unq(t)) || unq(t) === "--recursive")) return ["destructive"];
    // visible flags (`xargs rm -f`): fed by find/fd the stdin only adds file words (old decision, grantable);
    // any other feeder (`echo -r ~/x | xargs rm -f`) can add flags: unscoped.
    return tok.slice(1).some((t) => unq(t).startsWith("-")) && /^(?:find|fd)$/.test(segFeed) ? ["destructive"] : null;
  }
  if (opaque) {
    if (!catchAll(tok, seg, true)) return [];
    if (stripPrefix(tokens(seg)).xargs) return null;
    // `bash -c 'rm -rf build'` is understood: a destructive-only inner command is grantable.
    const inner = commandScopes(innerText(tok), protectedFor);
    return inner?.length && inner.every((x) => x === "destructive") ? ["destructive"] : null;
  }
  if (cmd === "git" || cmd === "hub") {
    // repoDir: null = unknown (an unresolvable cd/-C target, --git-dir): bare and plain pushes are push-main.
    let i = 1, config = false, hookKey = false, repoDir = segCwd === null ? null : segCwd || gateCtx.cwd || process.cwd();
    for (;;) {
      const t = unq(tok[i] ?? "");
      if (GIT_VALUE_OPTS.test(t)) {
        config ||= /^(?:-c|--config-env)$/.test(t);
        if (/^(?:-c|--config-env)$/.test(t)) hookKey ||= badGitKey(unq(tok[i + 1] ?? ""));
        if (t === "-C") repoDir = resolveDir(repoDir, tok[i + 1] ?? "");
        else if (/^--(?:git-dir|work-tree)$/.test(t)) repoDir = null;
        i += 2;
      }
      else if (/^(?:-[cC].|--[\w-]+=)/.test(t)) {
        config ||= /^(?:-c.|--config-env=)/.test(t);
        if (/^-c./.test(t)) hookKey ||= badGitKey(t.slice(2));
        else if (/^--config-env=/.test(t)) hookKey ||= badGitKey(t.slice(13));
        if (/^-C./.test(t)) repoDir = resolveDir(repoDir, tok[i].slice(2));
        else if (/^--(?:git-dir|work-tree)=/.test(t)) repoDir = null;
        i++;
      }
      else if (GIT_FLAG_OPTS.test(t)) i++;
      else if (t.startsWith("-")) return catchAll(tok, seg) ? null : []; // unknown global option
      else break;
    }
    const sub = unq(tok[i]), r = tok.slice(i + 1).map(unq);
    // `p=push; git $p origin HEAD:main`: the subcommand is computed, the alias check cannot
    // read it and it must not fall through as an unknown-but-free alias.
    if (/[$`\u0001\u0002]/.test(sub)) return null;
    if (sub === "push") {
      const unsafe = config || gitEnv || /[<'"$\x60\\*?{}[\]~^]/.test(tok.slice(i).join(" "));
      // An earlier segment of the same command may have changed the repo state (segTaint).
      return pushScopes(r, unsafe, protectedFor, repoDir && !segTaint ? { branch: currentBranch(repoDir), cfg: gitConfig(repoDir) } : null);
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
    // (H7f) subcommands that push (`subtree push|split`, `lfs push`, `send-pack`) or run a command string (`submodule foreach`, `rebase -x|--exec`, `bisect run`).
    if ((sub === "subtree" && r.some((t) => /^(?:push|split)$/.test(t))) || (sub === "lfs" && r.includes("push")) || sub === "send-pack") return ["push-main"];
    if (((sub === "submodule" && r.includes("foreach")) || (sub === "rebase" && r.some((t) => /^(?:-[a-zA-Z]*x|--exec(?:=|$))/.test(t))) || (sub === "bisect" && r[0] === "run")) && catchAll(tok, seg, true)) return null;
    // An unknown subcommand may be an alias (`[alias] p = push origin HEAD:main`, `q = !git push`):
    // guarded when the config defines it, or cannot be read.
    if (sub && !GIT_BUILTINS.test(sub)) {
      const cfg = repoDir ? gitConfig(repoDir) : null;
      if (!cfg || cfg.get("alias", null, sub.toLowerCase()) !== undefined) return null;
    }
    if (sub === "commit" && (hookKey || gitEnv || commitBypass(r))) return null;
    return [];
  }
  if (cmd === "docker") return dockerScopes(tok, seg, segTaint, segNoCd ? gateCtx.cwd : "");
  // (H7f) the git programs behind the subcommands (`/usr/lib/git-core/git-push`, `git-subtree push`).
  if (/^git-(?:push|send-pack)$/.test(cmd) || (/^git-(?:subtree|lfs)$/.test(cmd) && tok.slice(1).some((t) => /^(?:push|split)$/.test(unq(t))))) return ["push-main"];
  if (PM.test(cmd) || cmd === "npx") {
    if (cmd === "npx") return catchAll(tok, seg) ? null : [];
    let i = 1;
    while (unq(tok[i] ?? "").startsWith("-")) i += NPM_VALUE_OPTS.test(unq(tok[i])) ? 2 : 1;
    const sub = unq(tok[i]), next = unq(tok[i + 1]);
    if (/[$`\u0001\u0002]/.test(sub)) return null; // (H2) computed subcommand
    if (/^(?:publish|version)$/.test(sub) || (cmd === "yarn" && sub === "npm" && next === "publish")) return ["publish"];
    // (H7f) any other subcommand may run a release bin (`pnpm changeset publish`, `yarn lerna publish`, `yarn workspaces foreach npm publish`).
    return !PM_SAFE.test(sub) && catchAll(tok, seg) ? null : [];
  }
  if (cmd === "rm") {
    const r = tok.slice(1).map(unq);
    const end = r.indexOf("--");
    return r.slice(0, end === -1 ? undefined : end).some((t) => /^-[a-zA-Z]*[rR]/.test(t) || t === "--recursive") ? ["destructive"] : [];
  }
  if (cmd === "gh") {
    const { a, b, rest } = ghParts(tok);
    if (/[$`\u0001\u0002]/.test(a) || (a !== "api" && /[$`\u0001\u0002]/.test(b))) return null; // (H2) computed subcommand
    if (a === "pr" && b === "merge") return ["merge"];
    if (a === "pr" && /^(?:create|comment|edit|review|close)$/.test(b)) return ["github-write"];
    if (a === "release" && b === "create") return ["publish"];
    if (a === "release" && /^(?:edit|delete)$/.test(b)) return ["github-write"];
    if (a === "issue" && /^(?:create|comment)$/.test(b)) return ["github-write"];
    if (a === "repo" && /^(?:create|edit|delete)$/.test(b)) return ["github-write"];
    if (a === "repo" && b === "sync") return ["push-main"]; // updates a branch (the default one unless -b is given)
    if (a === "api") {
      const s = [b, ...rest].join(" ");
      if (b === "graphql" && !/mutation/i.test(s) && !/(?:-X|--method)/i.test(s)) return [];
      if (/(?:^|\s)(?:-[Xx]\s*|--method[\s=]+)(?:POST|PATCH|PUT|DELETE)\b/i.test(s) || /(?:^|\s)(?:-[fF]|--field|--raw-field|--input)/.test(s)) return ghApiScopes([b, ...rest], protectedFor);
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
// A guarded verb a later word could complete a computed head into (`$x push`, `$D rm -rf x`).
const GUARDED_NOUN = /^(?:push|reset|clean|branch|worktree|config|publish|version|merge|create|delete|edit|comment|close|review|api|sync|rm|exec)$/;
// A word that makes the NEXT word a command position (shell/xargs head, a shell's -c value,
// ALL of the WRAPPERS (sudo, env, doas, nohup, time, nice, timeout, builtin, stdbuf,
// caffeinate, script, ... then/do/else/if...), a negation `!` or brace group `{`, assignments,
// or a word that itself ends in a separator because one glued to it: `sh -c "g=git; $g push"`,
// `p=push; $g $p ...`). The wrapper list is derived from the WRAPPERS keys so wrapper and
// command-position knowledge stay in sync; the separator rule reads only the last character
// (anchored), so a long token cannot cost quadratic time.
const CPOS_JOINER = new RegExp(`^(?:${[...Object.keys(WRAPPERS), "bash", "sh", "zsh", "dash", "ksh", "eval", "watch", "parallel", "-c", "!", "{"].join("|")})$|^\\w+=|[;&|(]$`);
// A computed command name inside opaque text (`sh -c '$x push'`, `sh -c 'g=git; $g push'`,
// `eval "$(echo git) push"`): catchAll matches literal words only, so it cannot see the verb
// the expansion assembles and would wrongly answer "unguarded". A `$`/backtick/${...}/$(...)
// word in COMMAND position therefore fails closed (null = plain GO), the same way commitBypass
// treats a bare $FLAGS among commit arguments. Arguments (`sh -c 'echo $HOME'`) keep today's
// decision; non-opaque top-level heads are covered at classify (the push|publish line) without this.
function cposDollar(w) {
  let cmd = true, wrapped = false; // the first word of an opaque text is a command position
  for (const x of w) {
    // a wrapper keeps command position through its option, numeric and value words
    // (`timeout 60 $g $p`, `sudo -u x $g`): once a wrapper word is seen in command position,
    // any later $ word fails closed, however many arguments the wrapper takes.
    if ((cmd || wrapped) && /^[$`\u0001\u0002]/.test(x)) return true;
    if (cmd) cmd = CPOS_JOINER.test(x);
    if (cmd && WRAPPERS[base(x)]) wrapped = true;
  }
  return false;
}

// Bodies the segment split cannot keep whole: the `;` inside `sh -c 'g=git; p=push; $g $p
// origin main'` splits the command into fragments before classify sees it, so the $-head
// rule never fires and `sh -c 'g=git; p=push; $g $p origin HEAD:main'` is read as free.
// This re-reads the token row of the command view (quotes stay glued there): every sh/bash/
// zsh/dash/ksh takes option tokens up to its -c flag and its body is the first token after
// that (a docker run's `sh -c` after the image is the same token row), and eval's single
// quoted argument is its whole body. Each body's words are then judged by cposDollar as a
// whole. Literal expansions are already covered by the per-piece rules; this closes the
// pieces that a variable/volume/verb boundary hides the joiner context from.
function opaqueBodyWords(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const h = base(toks[i]);
    let body = null;
    if (h === "eval") { if (/^['"]/.test(toks[i + 1] ?? "")) body = toks[++i]; }
    else if (SHELLS.test(h)) {
      // Every option token is scanned, not just the first: `bash -o pipefail -c '...'` reaches
      // -c. -o/-O and --rcfile/--init-file take a value, which is skipped whole; a BUNDLED -o
      // (`bash -euo pipefail -c ...`) takes the next word as its value the same way, so the
      // scan must not stop at `pipefail` (9); any other option is its own token. The first
      // token after -c is the body.
      let j = i + 1, sawC = false;
      while (j < toks.length) {
        const o = unqQ(toks[j]);
        if (!/^-/.test(o)) break;
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(o)) { sawC = true; break; }
        if (/^(?:-[oO]|--rcfile|--init-file)$/.test(o) || /^-[a-zA-Z]*[oO][a-zA-Z]*$/.test(o)) j += 2; else j++;
      }
      if (sawC && toks[j + 1]) { body = toks[++j]; i = j; }
    }
    if (body) {
      // The body is shell source: split it the way the shell reads it. A plain whitespace
      // split misses a `$` word glued to a `;` (`true;g=git;p=push;$g $p ...`) and a
      // ${IFS}-glued body, so scanSplit (quote- and `;`-aware) cuts the statements and
      // stripPrefix removes wrappers/assignments before scopesOf judges each statement's
      // token row with cposDollar. unq first removes the quotes and the backslashes of an
      // escaped body (`sh -c g=git\;p=push\;\$g ...`), so the same rules apply to it; the
      // ${IFS}/$IFS words read as spaces before the split (4).
      for (const p of scanSplit(unIFS(unq(body)))) {
        const t = p.t.trim();
        if (t) out.push(stripPrefix(tokens(t)).rest);
      }
    }
  }
  return out;
}
function catchAll(tok, seg, opaque = false) {
  // inside sh -c / eval / watch the quoted text is the command, so split it into words;
  // scanSplit also cuts the statement boundaries a glued `;` or a ${IFS}-glued body hides
  // from a plain whitespace split, so glued statements keep their command positions.
  const rawWords = braceRow(opaque
    ? tok.flatMap((t) => scanSplit(unIFS(unq(t))).flatMap((p) => tokens(p.t.trim())))
    : tok);
  const w = rawWords.map(base), raw = rawWords.map(unq);
  if (opaque && cposDollar(w)) return true;
  // One backward pass builds suffix lookups over the words AFTER i (arrays are read at
  // [i + 1]), so every rule below is O(1) instead of a per-word slice scan: five thousand
  // `$a` words must not cost quadratic time. tick() keeps the loop inside the budget.
  const n = w.length;
  const DOLLAR = /^[$`\u0001\u0002]/;
  const noun = new Array(n + 1).fill(false), verb = new Array(n + 1).fill(false),
    pub = new Array(n + 1).fill(false), pubOnly = new Array(n + 1).fill(false), ghv = new Array(n + 1).fill(false),
    rec = new Array(n + 1).fill(false), hasCommit = new Array(n + 1).fill(false),
    bypassish = new Array(n + 1).fill(false), dollar = new Array(n + 1).fill(false),
    nonDash = new Array(n + 1).fill("");
  for (let i = n - 1; i >= 0; i--) {
    const b = w[i], r = raw[i];
    noun[i] = noun[i + 1] || GUARDED_NOUN.test(b);
    verb[i] = verb[i + 1] || GIT_VERBS.test(b);
    pub[i] = pub[i + 1] || /^(?:publish|version)$/.test(b);
    pubOnly[i] = pubOnly[i + 1] || b === "publish";
    ghv[i] = ghv[i + 1] || /^(?:merge|create|delete|edit|comment|close|review|api|sync)$/.test(b);
    rec[i] = rec[i + 1] || /^-[a-zA-Z]*[rR]/.test(b) || b === "--recursive";
    hasCommit[i] = hasCommit[i + 1] || b === "commit";
    bypassish[i] = bypassish[i + 1] || COMMIT_WORD_BYPASS.test(r) || /^[$\x60]/.test(r) || (/^-/.test(r) && /[$\x60]/.test(r));
    dollar[i] = dollar[i + 1] || DOLLAR.test(b);
    nonDash[i] = !b.startsWith("-") ? b : nonDash[i + 1];
  }
  let cmd = true; // the first word of any segment text is a command position
  for (let i = 0; i < n; i++) {
    tick();
    const b = w[i];
    // a computed head that a later guarded verb would complete at [i + 1] (`$x push`,
    // `$D rm -rf x`, `$X rst`), or one whose NEXT word is computed too (`g=git; p=push;
    // $g $p origin HEAD:main`, `sudo $g $p`): the verb is assembled from variables, so it
    // is unscoped. Only in command position (tracked like cposDollar), unless opaque where
    // the shell text can sit anywhere between built words: `echo $X config` is data.
    if ((cmd || opaque) && DOLLAR.test(b) && (noun[i + 1] || (cmd && dollar[i + 1]))) return true;
    if (cmd && (gluedHead(b) || globHead(raw[i]))) return true;
    if ((b === "git" || b === "hub") && (noun[i + 1] || (verb[i + 1] || (hasCommit[i + 1] && bypassish[i + 1])))) return true;
    // `npm view|info|show|v <pkg> version` only reads: its subcommand is not publish/version.
    if ((PM.test(b) || b === "npx") && !/^(?:view|info|show|v)$/.test(nonDash[i + 1]) && pub[i + 1]) return true;
    if (b === "gh" && ghv[i + 1]) return true;
    if (/^(?:np|release-it|semantic-release)$/.test(b) || (b === "changeset" && pubOnly[i + 1]) || (b === "lerna" && pub[i + 1])) return true;
    if (b === "rm" && rec[i + 1]) return true;
    cmd = CPOS_JOINER.test(b);
  }
  return false;
}

// Test support only: the catchAll internals the differential in tests/go-gate-gatefix2.test.js
// compares against. No production consumer; nothing else reads this.
export const _catchAllInternals = {
  catchAll, cposDollar, tokens, unq, base, scanSplit, classify, stripPrefix, opaqueBodyWords,
  hasGuardedAssign: (segs) => hasGuardedAssign(segs),
  GUARDED_NOUN, GIT_VERBS, CPOS_JOINER, PM, COMMIT_WORD_BYPASS,
};

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
// Read-only gh calls: their quoted words (--jq/-q filters, --search, --template) are data for gh, never shell.
// Kept as command text, the segment split read `.[]|.x[0:8]` as a new command with a glob head (unscoped).
const GH_READ_GROUP = /^(?:pr|run|release|issue|repo|workflow|label|cache|secret|variable|gist|ruleset|codespace)$/;
const GH_READ_VERB = /^(?:view|list|checks|diff|status|watch)$/;
function ghRead(rest) {
  const a = rest.slice(1).map(unq);
  let i = 0;
  for (;;) {
    if (/^(?:-R|--repo)$/.test(a[i] ?? "")) i += 2;
    else if (/^--repo=/.test(a[i] ?? "")) i += 1;
    else break;
  }
  const g = a[i] ?? "", v = a[i + 1] ?? "";
  return /^(?:status|search|--version|--help)$/.test(g) || (GH_READ_GROUP.test(g) && GH_READ_VERB.test(v));
}
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
    if ((i & 1023) === 0) tick();
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

// Rule 16 (Tim, 2026-10-06): a host command that is only `docker run` with read-only bind
// mounts, optionally piped into plain readers, cannot touch the host from inside the
// container. Script files and inline code it names are not read and the post-block cooldown
// does not apply. Every other check (patterns, scopes, delete targets in the text) still runs.
// Any flag not listed here (--privileged, --pid, --mount, --volumes-from, --cap-add, --device,
// --ipc, --security-opt, ...) or a docker.sock / rw mount makes it an ordinary command.
const DOCKER_FLAG = /^(?:--rm|-i|-t|-it|-ti|--interactive|--tty|--init|-q|--quiet|--read-only)$/;
const DOCKER_VALUE = /^(?:-e|--env|-w|--workdir|--name|--entrypoint|--platform|--memory|--cpus|--network|--net|-u|--user|--pull|-l|--label)$/;
const DOCKER_READER = /^(?:tail|head|grep|wc|sort|uniq|cut)$/;
// :ro does not stop a container from reading secrets or connect()ing to a socket, so broad
// sources are refused: `/`, the docker socket and its parent dirs, home, its ancestors and its dotdirs.
// A deny-list of broad paths was bypassable (`/.`, `/var/run/.`, `//Users/x`, case, symlinks), so
// this is an allow-list: an existing project directory at least two levels inside home, resolved
// through symlinks (realpath), with plain characters only, no dot segment and not under ~/Library.
// `/`, /etc, the docker socket dirs, /Volumes, other users and dotdirs are ordinary commands again.
// Known limit: the container may still read files inside that project (e.g. a .env) and use the network.
// Windows: `C:/dir:/src` has a drive colon, and realpath.native returns `\` paths. Work on `/` spellings, compare case-insensitively.
const winSlash = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);
const splitMount = (v) => {
  const s = unqQ(v), d = process.platform === "win32" ? /^([A-Za-z]:)(?=[\\/])/.exec(s) : null;
  const p = (d ? s.slice(2) : s).split(":");
  if (d) p[0] = d[1] + p[0];
  return p;
};
const mountSource = (src, marker = false) => {
  src = winSlash(src);
  if (!/^(?:[A-Za-z]:)?\/[A-Za-z0-9._ /-]+$/.test(src) || /\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(src)) return false;
  const home = osHome();
  if (!home) return false;
  let real, realHome;
  try { real = winSlash(realpathSync.native(src)); realHome = winSlash(realpathSync.native(home)); if (!statSync(real).isDirectory()) return false; } catch { return false; }
  const ci = (x) => (process.platform === "win32" ? x.toLowerCase() : x);
  if (!ci(real).startsWith(`${ci(realHome)}/`)) return false;
  const rel = real.slice(realHome.length + 1).split("/");
  if (!(rel.length >= 2 && !rel.some((s) => s.startsWith(".")) && rel[0] !== "Library")) return false;
  // container-test only (marker = true): a mount is a project, not a folder of projects or documents, so it holds a .git entry or a
  // package.json at its root. Rule 16 (read-only mounts) keeps its older, looser rule.
  return !marker || existsSync(join(real, ".git")) || existsSync(join(real, "package.json"));
};
const roMount = (v) => {
  const p = splitMount(v);
  if (p.length < 3 || !p.slice(2).join(":").split(",").includes("ro")) return false;
  return mountSource(p[0]);
};
export function isReadOnlyDockerRun(command) {
  if (typeof command !== "string" || commandTooLong(command)) return false;
  const parts = [];
  let cur = "", q = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i], n = command[i + 1] ?? "", p = command[i - 1] ?? "";
    if (q === "'") { cur += c; if (c === "'") q = ""; continue; }
    if (c === "`" || (c === "$" && n === "(")) return false; // host-side substitution
    if (q === '"') { cur += c; if (c === "\\") cur += command[++i] ?? ""; else if (c === '"') q = ""; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "\\") { cur += c + n; i++; continue; }
    if (/[;\n<(){}]/.test(c)) return false;
    if (c === "&" && p !== ">" && n !== ">") return false; // only 2>&1 / &> redirects
    if (c === "|") { if (n === "|" || n === "&") return false; parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (q) return false;
  parts.push(cur);
  const tok = words(parts[0].trim());
  if (unqQ(tok[0]) !== "docker" || unqQ(tok[1]) !== "run") return false;
  let image = false;
  // A shell expansion before the image can turn into any flags (`$FLAGS` → --privileged -v /:/h).
  const expands = (w) => /\$/.test(w ?? "") && !/^'[^']*'$/.test(w);
  for (let i = 2; i < tok.length && !image; i++) {
    if (expands(tok[i]) || (!tok[i].includes("=") && tok[i].startsWith("-") && expands(tok[i + 1]))) return false;
    const t = unqQ(tok[i]);
    const eq = /^(--?[\w-]+)=(.*)$/.exec(t);
    const flag = eq ? eq[1] : t, val = eq ? eq[2] : unqQ(tok[i + 1] ?? "");
    if (flag === "-v" || flag === "--volume") { if (!roMount(val)) return false; if (!eq) i++; continue; }
    if ((flag === "--network" || flag === "--net") && val === "host") return false;
    // `-e`/`--env` exactly like dockerScopes: only a plain KEY=literal value keeps the run
    // rule 16; a bare NAME forwards the HOST variable into the container (secrets).
    if ((flag === "-e" || flag === "--env") && !/^[A-Za-z_][A-Za-z0-9_]*=[^`$"~\s]*$/.test(val.replace(/["'\\]/g, ""))) return false;
    if (DOCKER_FLAG.test(t)) continue;
    if (DOCKER_VALUE.test(flag)) { if (!eq) i++; continue; }
    if (t.startsWith("-")) return false;
    image = true;
  }
  if (!image) return false;
  return parts.slice(1).every((s) => DOCKER_READER.test(base(words(s.trim())[0] ?? "")));
}

// A host command whose only real action is a container-test docker run (dockerScopes: allow-listed flags, project
// mounts, nothing dangerous in the text after the image), optionally with leading `cd`, redirects and plain readers
// (tail, grep, ...) after it, separated by ; && | or newlines. Like rule 16 it keeps script files and inline code that
// the container runs out of analyzeDeletes: they run in the container, where the project mount is all they can touch.
// Without this, `docker run ... npm test` was read as the host running every test script (rmSync in a test file =
// unscoped) and a container-test grant covered nothing. Every other check on the command text still runs.
export function isContainerTestRun(command) {
  if (typeof command !== "string" || commandTooLong(command)) return false;
  const parts = [];
  let cur = "", q = "";
  for (let i = 0; i < command.length; i++) {
    const c = command[i], n = command[i + 1] ?? "", p = command[i - 1] ?? "";
    if (q === "'") { cur += c; if (c === "'") q = ""; continue; }
    if (c === "`" || (c === "$" && n === "(")) return false;
    if (q === '"') { cur += c; if (c === "\\") cur += command[++i] ?? ""; else if (c === '"') q = ""; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "\\") { cur += c + n; i++; continue; }
    if (/[<(){}]/.test(c)) return false;
    if (c === "&") {
      if (n === "&") { parts.push(cur); cur = ""; i++; continue; }
      if (p !== ">" && n !== ">") return false; // only 2>&1 / &> redirects
    }
    if (c === ";" || c === "\n") { parts.push(cur); cur = ""; continue; }
    if (c === "|") { if (n === "|" || n === "&") return false; parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (q) return false;
  parts.push(cur);
  const segs = parts.map((s) => s.trim()).filter(Boolean);
  let k = 0;
  while (k < segs.length && base(words(segs[k])[0] ?? "") === "cd") { if (/[$\x60]/.test(segs[k])) return false; k++; }
  if (k >= segs.length || unqQ(words(segs[k])[0] ?? "") !== "docker") return false;
  if (dockerScopes(stripPrefix(tokens(segs[k])).rest, segs[k], ENV_CHANGE.test(command), k === 0 ? gateCtx.cwd : "") === null) return false;
  // Readers may not write or run anything: no sort -o/--output/--compress-program, no uniq output file, nothing path-valued.
  const readerOk = (s) => {
    const w = words(s).map(unqQ), h = base(w[0] ?? "");
    if (!DOCKER_READER.test(h)) return false;
    if (h === "sort" && w.some((a) => /^(?:-[a-zA-Z]*o|--output|--compress-program|-T|--temporary-directory|--files0-from)/.test(a))) return false;
    if (h === "uniq" && w.slice(1).filter((a) => !a.startsWith("-")).length > 1) return false;
    if (/^(?:grep)$/.test(h) && w.some((a) => /^(?:-[a-zA-Z]*f|--file)/.test(a))) return false;
    return true;
  };
  return segs.slice(k + 1).every(readerOk);
}

// Scope `container-test` (Tim, 2026-10-06): a `docker run --rm` test run whose flags are all on the rule 16
// allow-list, whose mounts are project directories (mountSource: at least two levels inside home, no dotdir,
// symlinks resolved; read-only or writable), with no --privileged/--pid/--network host/docker.sock and no shell
// expansion before the image. Everything else about docker stays as it was; a docker run that does not qualify is
// guarded without a scope (plain GO). The text after the image is read by scopesOf like any other command text.
function dockerScopes(tok, seg, tainted = segTaint, pwd = "") {
  // A bare "$PWD" as a -v source is the shell's cwd (tracked through cd; "" = unknown), which mountSource then judges.
  // Windows: the hook gets a native cwd (C:\dir). Normalise it like a mount source and allow the drive letter.
  const pwdW = winSlash(pwd);
  if (pwdW && (process.platform === "win32" ? /^(?:[A-Za-z]:)?\/[A-Za-z0-9._ /-]+$/ : /^\/[A-Za-z0-9._ /-]+$/).test(pwdW)) tok = tok.map((t, k) => (k > 1 && /^(?:-v|--volume)$/.test(unq(tok[k - 1])) ? t.replace(/^(?:"\$PWD"|"\$\{PWD\}"|\$PWD|\$\{PWD\})(?=:)/, () => pwdW) : t));
  // Only the real `docker` word: a path-qualified or planted executable of that name is an ordinary command (GO only), and a
  // PATH or DOCKER_* assignment anywhere earlier in the command (taint, see ENV_CHANGE) could point the word at another program.
  if (unq(tok[0] ?? "") !== "docker") return base(tok[0] ?? "") === "docker" ? null : [];
  const sub = unq(tok[1] ?? "");
  if (sub.startsWith("-")) return tok.slice(1).some((t) => unq(t) === "run") ? null : []; // global option: another daemon or config
  // Known limit: the entry program is guessed from the image name for `run` only, and only
  // for names whose basename is a program (`alpine/git`); an image that wraps its program in
  // an unusual basename or entrypoint script is not seen here and needs a GO by other rules.
  // Every OTHER subcommand (exec, compose, build, ...) runs what its words say with no run
  // parser: `docker exec ctr git push origin HEAD:main`, `docker compose run app npm publish`
  // and `docker exec ctr sh -c 'git push origin HEAD:main'` are read like an opaque text, and
  // a guarded word anywhere in them needs a GO.
  if (!(sub === "run" || (sub === "container" && unq(tok[2] ?? "") === "run"))) {
    // (gatefix4 10) restore the old free decision for a read-only git branch row: exec/compose
    // hands the container exactly the visible words (no bash-style stdin), so the row is the
    // command — `docker exec ctr git branch` (no flags, no expansion) is free, like
    // `git branch` outside docker. Anything else behind exec/compose keeps the gatefix (7)
    // catch-all: a guarded word anywhere in it needs a GO.
    const gi = tok.findIndex((t, k) => k && /^(?:git|hub)$/.test(base(t)));
    // (H6) only when the REST of the row (sh -c bodies, quoted words) holds no guarded noun: catch-all it first.
    if (gi > 0 && unq(tok[gi + 1] ?? "") === "branch" && !tok.slice(gi + 2).some((t) => /^-/.test(unq(t)) || /[$\x60\u0001\u0002]/.test(unq(t))) &&
        !catchAll([...tok.slice(0, gi), ...tok.slice(gi + 2)], seg, true)) return [];
    return catchAll(tok, seg, true) ? null : [];
  }
  if (tainted) return null;
  if (/(?:^|[\s;&|(])DOCKER_\w+=/.test(seg)) return null;
  let rm = false, image = false, mounts = 0, allRo = true, i = sub === "run" ? 2 : 3;
  const expands = (w) => /[$\x60]/.test(w ?? "") && !/^'[^']*'$/.test(w); // an expansion can turn into any flags
  for (; i < tok.length && !image; i++) {
    const raw = tok[i];
    if (expands(raw)) return null;
    const t = unq(raw);
    const eq = /^(--?[\w-]+)=(.*)$/.exec(t);
    const flag = eq ? eq[1] : t, val = eq ? eq[2] : unq(tok[i + 1] ?? "");
    if (!eq && (flag === "-v" || flag === "--volume" || flag === "--network" || flag === "--net" || DOCKER_VALUE.test(flag)) && expands(tok[i + 1])) return null;
    if (flag === "-v" || flag === "--volume") {
      const isRo = roMount(val); // read-only project mounts keep rule 16's rule; only writable mounts need the project marker
      if (!mountSource(splitMount(val)[0], !isRo)) return null;
      mounts++; allRo &&= isRo;
      if (!eq) i++;
      continue;
    }
    if (flag === "--network" || flag === "--net") { if (!/^(?:none|bridge)$/.test(val)) return null; if (!eq) i++; continue; }
    if (t === "--rm") { rm = true; continue; }
    if (DOCKER_FLAG.test(t)) continue;
    // `-e`/`--env` only as KEY=literal: a bare NAME forwards the HOST variable into the
    // container (GH_TOKEN, NPM_TOKEN, ...), so it is not a literal and fails closed
    // (null = ordinary guarded command). No `$`, backtick, `~` or whitespace in the value;
    // the token regex keeps quoted values whole and unq strips their quotes.
    if (flag === "-e" || flag === "--env") {
      const v = eq ? eq[2] : unq(tok[i + 1] ?? "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*=[^`$"~\s]*$/.test(v.replace(/["'\\]/g, ""))) return null;
      if (!eq) i++;
      continue;
    }
    // --entrypoint replaces the image's own entry command with an arbitrary program (`--entrypoint
    // git ... push`, `--entrypoint rm ... -rf`, with the words after the image as its arguments).
    // Reconstructing the argv means trusting docker's image metadata, which is not read here:
    // fail closed instead (null = plain GO). The official test template uses no --entrypoint.
    if (flag === "--entrypoint") return null;
    if (DOCKER_VALUE.test(flag)) { if (!eq) i++; continue; }
    if (t.startsWith("-")) return null;
    image = true;
  }
  if (!image) return null;
  // The words after the image run inside the container, but git push, npm publish, gh writes and rm -r there
  // still need their own scope or a GO: the text is read like an opaque `sh -c`. This runs BEFORE the rule 16
  // early return: a read-only run cannot host a guarded command inside the container either (the mount is a
  // project clone with .git, remotes and credential helpers); only text that trips catchAll loses rule 16.
  // An image whose basename is the program itself (`alpine/git sudden push`, `git ...`) is fed as the first
  // word so catchAll sees `git push ...` too; tags and digests are stripped.
  const img = unq(tok[i - 1] ?? "").replace(/@[\s\S]*$/, "").replace(/:[^/:]*$/, "");
  const container = catchAll([img, ...tok.slice(i)], seg, true);
  if (container) return null;
  // Missing --rm: a read-only run needs a GO only when its mounts are not all read-only.
  // Rule 16 kept --rm optional (DOCKER_FLAG lists it as one flag among many), a reconnect
  // regression from the reorder placed the unclassified return ahead of this branch.
  if (mounts && allRo) return []; // rule 16: only read-only project mounts stay free, as before
  if (!rm) return null;
  return ["container-test"];
}

// Splits on unquoted ; & | newline ( ) and brace-group braces; quotes, ${...}, $(...) and `...` stay whole.
function scanSplit(cmd) {
  const s = String(cmd), out = [];
  let cur = "", q = "", depth = 0, sub = 0, bt = false;
  for (let i = 0; i < s.length; i++) {
    if ((i & 1023) === 0) tick();
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
    tick();
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
const AWK_EXEC = /system\s*\(|getline|close\s*\(|\|\s*["'$]|\bprint[^;}]{0,200}\|\s*\S/;
const SED_EXEC = /(?<![A-Za-z_\\])e(?![A-Za-z_])|\/[gimIM0-9]*e[gimIM0-9]*\s*(?:["';}]|$)/;
// feeds[k]: does any LATER stage of the pipeline that piece k starts run a shell or interpreter?
// One backwards pass: chain[j] = the pipeline continues after piece j and a later stage feeds a shell.
function pipeFeedsAll(pieces, heads) {
  const chain = new Array(pieces.length).fill(false);
  for (let j = pieces.length - 2; j >= 0; j--) chain[j] = "|(){".includes(pieces[j].sep || "x") && (FEEDS.test(heads[j + 1]) || chain[j + 1]);
  return pieces.map((p, k) => p.sep === "|" && k + 1 < pieces.length && (FEEDS.test(heads[k + 1]) || chain[k + 1]));
}
// Inline interpreter code (node -e, python -c ...) is blanked too unless keepCode: it is
// not shell text, so execution points are read from it by analyzeDeletes instead.
function blankData(text, keepCode = false) {
  const pieces = scanSplit(text);
  const parsed = pieces.map((p) => { tick(); return stripPrefix(tokens(p.t)); });
  const feeds = pipeFeedsAll(pieces, parsed.map((s) => base(s.rest[0] ?? "")));
  return pieces.map((p, k) => {
    tick();
    const { rest, opaque } = parsed[k];
    const h = base(rest[0] ?? "");
    if (!keepCode && !opaque && INTERP.test(h) && !/^(?:pwsh|powershell|cmd)/i.test(h) && scriptFile(h, rest.slice(1).map(unqQ)).inline) return blankQuotes(p.t) + p.sep;
    const sub = h === "git" ? rest.slice(1).map(unq).find((t, i, a) => !t.startsWith("-") && !/^-[cC]$/.test(a[i - 1] ?? "")) : "";
    const prog = rest.slice(1).filter((t) => !t.startsWith("-")).map(unqQ).join(" ");
    // git grep -O<cmd> / --open-files-in-pager=<cmd> runs a shell command: its quoted text is code, never data.
    const gitPager = sub === "grep" && rest.slice(1).map(unq).some((t) => /^--open-files-in-pager\b/.test(t) || /^-[A-Za-z]*O/.test(t));
    const executes = (/^g?awk$/.test(h) && AWK_EXEC.test(prog)) || (h === "sed" && SED_EXEC.test(prog)) || gitPager;
    // `aos-a2a send|reply ... "<message>"` (also `node <dir>/aos-a2a.mjs ...`): the quoted message is data for the A2A client and
    // is never run; read as command text, words like `; git push` inside a peer message made the whole send guarded (GO only).
    // The script file of a `node` run is still analysed on its own (scriptInto), so a planted aos-a2a.mjs gains nothing.
    // Strict on purpose: the bare command name (no path, no PATH= assignment that could point it at a planted file) or node with an
    // absolute aos-a2a.mjs inside an installed tool directory. Anything else keeps its quoted text as command text.
    const head0 = unq(rest[0] ?? ""), arg1 = unqQ(rest[1] ?? "");
    const a2aCli = !/(?:^|\s)PATH=/.test(p.t) &&
      (head0 === "aos-a2a" || (/^node(?:js)?$/.test(head0) && /^(?:[A-Za-z]:)?\//.test(winSlash(arg1)) && base(winSlash(arg1)) === "aos-a2a.mjs" && trustedDirs().some((d) => (process.platform === "win32" ? winSlash(arg1).toLowerCase().startsWith(winSlash(d + sep).toLowerCase()) : arg1.startsWith(d + sep)))));
    return ((DATA_HEAD.test(h) || sub === "grep" || a2aCli || (h === "gh" && ghRead(rest))) && !opaque && !executes && !feeds[k] ? blankQuotes(p.t) : p.t) + p.sep;
  }).join("");
}

// Quote-aware pre-pass. An unquoted `#` at a word start comments out the rest of the line.
// Backticks and `$(` inside single quotes, or backslash-escaped, are inert: they become the
// placeholders \u0001 / $\u0002, which unprep() turns back where the text really is executed
// (bash -c '...', node -e '...').
function prepText(s) {
  let out = "", q = "";
  for (let i = 0; i < s.length; i++) {
    if ((i & 1023) === 0) tick();
    const c = s[i];
    if (q === "'") {
      if (c === "'") { q = ""; out += c; }
      else if (c === "`") out += "\u0001";
      else if (c === "$" && s[i + 1] === "(") { out += "$\u0002"; i++; }
      else out += c;
      continue;
    }
    if (c === "\\") { const n = s[++i] ?? ""; if (n === "\n") continue; out += n === "`" ? "\u0001" : c + n; continue; }
    if (q === '"') { if (c === '"') q = ""; out += c; continue; }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    if (c === "#" && (i === 0 || /[\s;&|(]/.test(s[i - 1]))) { while (i < s.length && s[i] !== "\n") i++; i--; continue; }
    out += c;
  }
  return out;
}
const unprep = (s) => String(s).replace(/\u0001/g, "`").replace(/\$\u0002/g, "$(");

export function commandView(command, keepCode = false) {
  const { text, code } = stripHeredocs(winNorm(command));
  return { text: blankData(prepText(text), keepCode), code };
}

const HOME_VAR = String.raw`(?:~[\w.+-]*|\$HOME|\$USERPROFILE|%USERPROFILE%|%HOMEPATH%|\$env:(?:USERPROFILE|HOME)|\$\{env:(?:USERPROFILE|HOME)\})`;
const HOME_PATH = new RegExp(`^${HOME_VAR}(?:/(.*))?$`, "i");
// The OS user's real home. A test override (AOS_GATE_TEST_REALHOME) is honoured ONLY inside a
// test run (AOS_TEST_SANDBOX or NODE_TEST_CONTEXT set), so production always uses the OS value.
const osHome = () => {
  const o = process.env.AOS_GATE_TEST_REALHOME;
  if (o && (process.env.AOS_TEST_SANDBOX || process.env.NODE_TEST_CONTEXT)) return o.replace(/\/+$/, "");
  try { return userInfo().homedir.replace(/\/+$/, ""); } catch { return ""; }
};
const pathSegs = (s) => String(s ?? "").split("/").filter((x) => x && x !== ".");
const GLOB = /[*?{}[\]]/;
// A segment made only of glob syntax (`*`, `.*`, `??*`, `.[!.]*`, `[^.]*`, `[a-z]*`, `{*,.*}`).
const WILD_TAIL = { test: (s) => /^[.*?]*[*?][.*?]*$/.test(String(s).replace(/\[[^\]]*\]|\{[*?.,]*\}/g, "*")) };

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
  // `<top-level>/*`, `<top-level>/.*`, `.[!.]*`: a wildcard-only tail empties a top-level directory of
  // home. `*.log`, `{a,b}` and anything deeper (`~/Documents/sub/*`) are ordinary paths.
  const emptied = (r, i) => (r.length === i + 2 && !GLOB.test(r[i]) && WILD_TAIL.test(r[i + 1]) ? { kind: "emptied" } : null);
  let m = HOME_PATH.exec(s);
  if (m) {
    const r = pathSegs(m[1]);
    if (r.includes("..") || r.length === 0) return { kind: "home" };
    return r.length === 1 ? child(r[0], join(gateCtx.home || homedir(), r[0])) : emptied(r, 0);
  }
  m = /^(?:[A-Za-z]:)?\/(?:Users|home)(?:\/(.*))?$/i.exec(s);
  if (m) {
    const r = pathSegs(m[1]);
    if (r.includes("..") || r.length <= 1) return { kind: "home" };
    return r.length === 2 ? child(r[1], /^\//.test(s) ? s : "") : emptied(r, 1);
  }
  m = /^\/root(?:\/(.*))?$/.exec(s);
  if (m) {
    const r = pathSegs(m[1]);
    if (r.includes("..") || r.length === 0) return { kind: "home" };
    return r.length === 1 ? child(r[0], s) : emptied(r, 0);
  }
  const rh = gateCtx.realHome ?? osHome();
  if (rh && (s === rh || s.startsWith(rh + "/"))) {
    const r = pathSegs(s.slice(rh.length));
    if (r.includes("..") || r.length === 0) return { kind: "home" };
    return r.length === 1 ? child(r[0], s) : emptied(r, 0);
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
  if (k.kind === "glob" || k.kind === "emptied") return strong ? "hard" : "go";
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
  let cmd = base(tok[0] ?? "").toLowerCase();
  if (globHead(cmd)) { const re = globRe(cmd); cmd = ["rm", "rmdir", "unlink", "shred", "trash"].find((n) => re.test(n)) ?? cmd; } // (H7d) `/bin/[r]m`
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
// ws = { root, cwd } for a script that lives in the session's own repo: a recursive delete whose literal target resolves inside
// that root is recorded as r.workspace (scope `workspace`) instead of r.destructive. Anything else stays destructive.
function codeInto(r, text, lang = "", ws = null, inline = false) {
  text = unprep(text);
  // A script that changes its own working directory makes relative targets unjudgeable: no workspace scope then.
  if (ws && /\bchdir\s*\(|\bcd\s*\(|process\.chdir|os\.chdir|Dir\.chdir|\bchdir\b/.test(maskStrings(text))) ws = null;
  if (lang === "osascript" && /\bdelete\b|\bmove\b[^\n;]*\bto\b[^\n;]*\btrash|\bdo shell script\b/i.test(text)) r.unscoped = true;
  const masked = maskStrings(text);
  if (UNSCOPED_CODE.test(masked) || HTTP_PATTERNS.some((re) => re.test(text))) r.unscoped = true;
  for (const m of masked.matchAll(DEL_CALL)) {
    const name = m[0].replace(/\s*\(?\s*$/, "");
    const after = text.slice(m.index + m[0].length);
    const rec = RECURSIVE_CALL.test(name.replace(/^.*\./, "")) || (OPTION_CALL.test(name) && /recursive/.test(after.slice(0, 300)));
    const p = codeArgToPath(after);
    if (rec) { if (ws && p && insideWorkspace(ws, p)) r.workspace = true; else r.destructive = true; }
    const v = p ? homeVerdict(p, { recursive: rec }) : null;
    if (v === "hard") r.hard ||= p;
    else if (v === "go") r.unscoped = true;
  }
  for (const m of masked.matchAll(EXEC_CALL)) {
    const c = execCommand(text.slice(m.index + m[0].length), m[0].replace(/\s*\(?\s*$/, ""));
    if (c) r.cmds.push(c);
    // Inline code only: a spawn whose command is not a literal (process.argv[1], a variable) hides what runs.
    else if (inline) r.unscoped = true;
  }
  if (/^(?:ruby|perl)$/.test(lang)) {
    for (const m of text.matchAll(/`([^`\n]*)`|%x[({[]([^)}\]]*)|\bqx[({[]([^)}\]]*)/g)) r.cmds.push(m[1] ?? m[2] ?? m[3]);
  }
}

// Script files run by an interpreter. cwd follows `cd X &&` inside the command; the hook's
// own cwd (setGateContext) is the start. Block cooldown: see markBlock.
let gateCtx = { cwd: "", blockTs: 0 };
export const setGateContext = (c) => { gateCtx = { cwd: "", blockTs: 0, ...c }; memo = new Map(); };
// Clock for the installed-script age check. Only the hook sets gateCtx (from the harness input, never from the command), so `now` is a test seam, not an input.
const nowMs = () => (Number.isFinite(gateCtx.now) ? gateCtx.now : Date.now());
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
    // Option values are not script files: `bash -o pipefail echo hi` would otherwise read
    // 'pipefail' as a script and fail closed (a file that is not there is unscoped).
    if (/^(?:-[oO]|--rcfile|--init-file)$/.test(t) || (/^(?:bash|sh|zsh|dash|ksh)$/.test(lc) && /^-[a-zA-Z]*[oO]$/.test(t))) { i++; continue; }
    // node -c / --check only parses the file: nothing runs, so there is no script to scope.
    if (/^node(?:js)?$/.test(lc) && /^(?:-c|--check)$/.test(t)) return {};
    if (INLINE_FLAG.test(t) && !/^(?:bash|sh|zsh|dash|ksh)$/.test(lc)) return { inline: true };
    if (/^(?:-c|-[a-zA-Z]*c)$/.test(t) && /^(?:bash|sh|zsh|dash|ksh)$/.test(lc)) return { inline: true };
    if (VALUE_FLAG.test(t)) { i++; continue; }
    if (t.startsWith("-")) continue;
    return { file: t };
  }
  return {};
}

// Installed tool locations. A script there is a tool someone installed, not code the agent just
// wrote: only the home-level hard check applies to it, so a tool CLI with a delete subcommand
// somewhere in its source (`token-saver uninstall`) is not "destructive" for every call.
// Integrity guard: a file counts as installed only if it is older than the session's first block
// or older than the cooldown, and its real path stays inside the trusted dir (no symlink out).
// Limit: an agent can still backdate a file (touch -t) it was able to write into such a dir.
function trustedDirs() {
  const home = gateCtx.home || homedir();
  const claude = gateCtx.claudeDir || process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  return [
    join(claude, "plugins", "cache"), join(home, ".agents"), join(home, ".gemini", "config"), join(home, ".local", "share"), join(home, ".local", "pipx"),
    join(dirname(dirname(process.execPath)), "lib", "node_modules"), "/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules", "/opt/homebrew/Cellar", "/usr/local/Cellar",
  ];
}
// The three memB entry scripts the memb-ingest skill runs right after an install or update. Exempt from the
// cooldown by exact basename and exact directory (real paths), never by content: any other script stays analysed.
// Limit: an agent able to write into the memB dir could replace one of these three files.
const MEMB_SCRIPTS = new Set(["memb_ingest.py", "memb_auto_inject.py", "run.py"]);
function membScript(path) {
  try {
    const real = realpathSync(path);
    if (!MEMB_SCRIPTS.has(real.slice(dirname(real).length + 1))) return false;
    const home = gateCtx.home || homedir();
    return [join(home, ".gemini", "config", "mcps", "memb-mcp"), join(home, ".agents", "memB")].some((d) => {
      try { return dirname(real) === realpathSync(d); } catch { return false; }
    });
  } catch { return false; }
}
function installedScript(path, changed) {
  if (membScript(path)) return true;
  if (!(gateCtx.blockTs ? changed < gateCtx.blockTs : false) && nowMs() - changed <= COOLDOWN_MS) return false;
  let real;
  try { real = realpathSync(path); } catch { return false; }
  return trustedDirs().some((d) => {
    let rd;
    try { rd = realpathSync(d); } catch { return false; }
    return (path === d || path.startsWith(d + sep) || path.startsWith(rd + sep)) && real.startsWith(rd + sep);
  });
}

// The session's own repo for a script file (scope `workspace`): the nearest directory above the script that holds a .git entry,
// as its realpath, at least two levels inside the real home, no dot segment below home, not under ~/Library, and the script's
// own realpath must lie inside it (a symlink out of the repo means no workspace). null = not a workspace script.
function workspaceFor(file, cwd) {
  try {
    const home = osHome();
    if (!home) return null;
    const realHome = realpathSync.native(home), realFile = realpathSync.native(file);
    let dir = dirname(realFile), root = null;
    for (let i = 0; i < 12 && dir !== dirname(dir); i++, dir = dirname(dir)) {
      if (existsSync(join(dir, ".git"))) { root = dir; break; }
    }
    if (!root || !realFile.startsWith(root + sep) || !root.startsWith(realHome + sep)) return null;
    const rel = root.slice(realHome.length + 1).split(sep);
    if (rel.length < 2 || rel.some((s) => s.startsWith(".")) || rel[0] === "Library") return null;
    // tied to the session: the shell's working directory must itself lie inside this repo (a planted repo elsewhere is not "own")
    const real = realpathSync.native(resolve(expandHome(cwd)));
    if (real !== root && !real.startsWith(root + sep)) return null;
    return { root, cwd: real };
  } catch { return null; }
}
// A literal delete target of a workspace script: resolved against the script's cwd, its existing parent directory resolved through
// symlinks, and the result must stay inside the repo root. No expansions, no home spellings: those are not "inside".
function insideWorkspace(ws, target) {
  const t = String(target);
  // No expansions, home spellings, `..`, globs or a dynamic tail (codeArgToPath turns `"x"+y` into `x/*`), no trailing slash.
  if (!t || /[$`*?{}[\]]|^~|^%|\\\\|\/$/.test(t) || /(?:^|\/)\.\.(?:\/|$)/.test(t)) return false;
  try {
    const abs = resolve(ws.cwd, t);
    let parent = dirname(abs);
    try { parent = realpathSync.native(parent); } catch { /* parent not there yet: the lexical path decides */ }
    let full = join(parent, abs.slice(dirname(abs).length + 1));
    try { full = realpathSync.native(full); } catch { /* the target does not exist yet */ }
    // strictly below the repo root (never the root itself) and never the repository's own .git (any segment, any case)
    return full.startsWith(ws.root + sep) && !/(?:^|[\\/])\.git(?:[\\/]|$)/i.test(full.slice(ws.root.length + 1));
  } catch { return false; }
}

function scriptInto(r, h, file, cwd) {
  const path = resolve(expandHome(cwd), expandHome(file));
  let st, changed;
  // ctime is included because `touch -t` can backdate mtime but never ctime.
  try { const l = lstatSync(path); st = statSync(path); changed = Math.max(st.mtimeMs, l.mtimeMs, st.ctimeMs, l.ctimeMs); } catch { r.unscoped = true; return; }
  // Only a regular file is ever opened: a device (/dev/zero), FIFO, socket or directory is
  // unscoped and never read (a read could hang the hook). statSync follows a symlink.
  if (!st.isFile()) { r.unscoped = true; return; }
  // Cooldown limits, said plainly: an agent can still backdate a script (touch -t), run one
  // written before the block, or remove the marker through a path built at run time; the
  // last is covered only for literal paths (isHomeLevel knows ~/.aos/gate).
  if (gateCtx.blockTs && nowMs() - gateCtx.blockTs < COOLDOWN_MS && changed > gateCtx.blockTs && !membScript(path)) { r.unscoped = true; r.cooldown = true; return; }
  if (st.size > SCRIPT_MAX) { r.unscoped = true; return; }
  const body = readSmallRegular(path, SCRIPT_MAX, true);
  if (typeof body !== "string") { r.unscoped = true; return; }
  const t = installedScript(path, changed) ?{ destructive: false, workspace: false, hard: null, unscoped: false, cooldown: false, cmds: [], files: [] } : r;
  if (/^(?:bash|sh|zsh|dash|ksh|pwsh|powershell)$/i.test(h)) t.cmds.push(body);
  else codeInto(t, body, h.toLowerCase().replace(/[\d.]+$/, "").replace(/^nodejs$/, "node"), t === r ? workspaceFor(path, cwd) : null);
  if (t !== r) {
    r.hard ||= t.hard;
    for (const c of t.cmds) r.hard ||= analyzeDeletes(c, 1).hard;
  }
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
    if (x === ".." && !out.length && p.startsWith("/")) continue; // the parent of / is /
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
  return normPath(ABS_LIKE.test(e) ? e : `${st.cwd}/${e}`);
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

// The texts of $(...) and `...` in one linear pass (an unmatched opener is ignored).
function substitutions(text) {
  const out = [], stack = [];
  for (let i = 0; i < text.length; i++) {
    if ((i & 1023) === 0) tick();
    const c = text[i];
    if (c === "$" && text[i + 1] === "(") { stack.push(i + 2); i++; }
    else if (c === ")" && stack.length) out.push(text.slice(stack.pop(), i));
    else if (c === "`") {
      const j = text.indexOf("`", i + 1);
      if (j === -1) break;
      out.push(text.slice(i + 1, j));
      i = j;
    }
    if (out.length > 64) break;
  }
  return out;
}

export function analyzeDeletes(command, depth = 0, init = null) {
  const r = { destructive: false, workspace: false, hard: null, unscoped: false, cooldown: false, cmds: [], files: [] };
  if (depth > 3 || typeof command !== "string") return r;
  if (command.length > MAX_COMMAND) { r.unscoped = true; return r; }
  const st = init ? { cwd: init.cwd, vars: { ...init.vars } } : { cwd: gateCtx.cwd || process.cwd(), vars: Object.create(null) };
  const ro = init ? !!init.ro : (isReadOnlyDockerRun(command) || isContainerTestRun(command));
  const snap = () => ({ cwd: st.cwd, vars: st.vars, ro });
  const merge = (o) => { r.destructive ||= o.destructive; r.workspace ||= o.workspace; r.hard ||= o.hard; r.unscoped ||= o.unscoped; r.cooldown ||= o.cooldown; r.cmds.push(...o.cmds); r.files.push(...o.files); };
  const { text, code } = commandView(command, true);
  const un = (t) => String(t).replace(/^"([\s\S]*)"$/, (_, x) => x.replace(/\\(["\\$`])/g, "$1")).replace(/^'([\s\S]*)'$/, "$1");
  const stack = [];
  const segment = (seg) => {
    tick();
    assignments(words(seg), st);
    const { rest: tok, opaque } = stripPrefix(braceRow(words(seg))); // (H7d) `{rm,-rf} ~`
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
    if (!ro && FILE_HEAD.test(h) && (!opaque || /^(?:bash|sh|zsh|dash|ksh)$/.test(h))) {
      const f = scriptFile(h, tok.slice(1).map(unqQ));
      if (f.module && /rm|remov|delet|rimraf|trash|clean|purge|wipe/i.test(f.module)) r.unscoped = true;
      if (f.inline && INTERP.test(h) && !/^(?:pwsh|powershell)$/i.test(h)) codeInto(r, tok.slice(1).map(un).join(" "), h.toLowerCase().replace(/[\d.]+$/, ""), null, true);
      else if (f.file) r.files.push({ h, file: f.file, cwd: st.cwd });
      // V13 H2: node runs preloaded modules (-r/--require/--import/--loader) before the main file, so they are read like it.
      if (/^node(?:js)?$/i.test(h)) {
        const a = tok.slice(1).map(unqQ);
        for (let i = 0; i < a.length; i++) {
          const m = /^(?:-r|--require|--import|--loader|--experimental-loader)(?:=(.*))?$/.exec(a[i]);
          if (!m) continue;
          const v = m[1] ?? a[++i];
          if (v) r.files.push({ h, file: v, cwd: st.cwd });
        }
      }
    }
  };
  for (const p of scanSplit(text)) {
    if (p.t.trim()) segment(p.t.trim());
    if (p.sep === "(") stack.push(st.cwd);
    else if (p.sep === ")" && stack.length) st.cwd = stack.pop();
  }
  if (!ro) for (const c of code) codeInto(r, c.body, c.lang.replace(/[\d.]+$/, "").replace(/^nodejs$/, "node"), null, true);
  const subs = substitutions(text);
  if (subs.length > 64) r.unscoped = true; // too many to read within the budget
  for (const s of subs.slice(0, 64)) merge(analyzeDeletes(unprep(s), depth + 1, snap()));
  // Spawned command texts are analysed too (their own cmds are classified by commandScopes).
  let seen = 0;
  const drain = () => {
    for (; seen < r.cmds.length; seen++) {
      if (depth >= 3) continue;
      const o = analyzeDeletes(r.cmds[seen], depth + 1, snap());
      r.destructive ||= o.destructive; r.workspace ||= o.workspace; r.hard ||= o.hard; r.unscoped ||= o.unscoped; r.cooldown ||= o.cooldown; r.files.push(...o.files);
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
  // No time budget here: the hard pass is linear and runs first, so slow input can never skip it.
  // Only the classification (commandScopes) falls back to unscoped when it runs out of time.
  const hard = analyzeDeletes(command).hard;
  return hard ? `Blocked by go-gate: HARD BLOCK, unconditional. This command deletes or moves away the home directory, the filesystem root or a top-level directory of home (target: ${hard}). No GO, grant, mode or token lifts this block. Stop now and report this command to the user; do not rephrase it or try another tool, language or route to the same effect.` : null;
}

const segGuarded = (seg) => { const c = classify(seg); return c === null || c.length > 0 || GUARDED_PATTERNS.some((r) => r.test(seg)); };

// A compound command that also rewrites git's push configuration (GIT_CONFIG_*, an exported
// GIT_ variable, git config of push/remote/url keys, git remote add/set-url) can redirect the
// push that follows; the whole command then gets no scope.
const UNSAFE_COMPOUND = /GIT_CONFIG|\bexport\s+GIT_|\bgit\b[^;&|\n]*\bconfig\b[^;&|\n]*(?:push|remote\.|url\.|insteadof)|\bgit\b[^;&|\n]*\bremote\s+(?:add|set-url|rename|set-branches)\b/i;

// A shell reading commands from stdin (`... | sh`, `bash -s`, `source /dev/stdin`, or a
// here-string `sh <<< "$c"`): the text it runs is whatever the other segments print, so
// their quoted words are the command.
function feedsShell(segs) {
  return segs.some((seg) => {
    const { rest } = stripPrefix(tokens(seg));
    const head = base(rest[0] ?? ""), args = rest.slice(1).map(unq);
    if (/^(?:sh|bash|zsh|dash|ksh|fish)$/.test(head)) return !args.some((a) => !a.startsWith("-")) || args.includes("-s") || args.includes("/dev/stdin") || args.some((a) => a.startsWith("<<<"));
    return /^(?:source|\.)$/.test(head) && args.some((a) => a === "/dev/stdin" || a === "-");
  });
}

// (gatefix4 2) an assignment (`c="git push"`, `c=git`) whose value names a guarded program
// anywhere in the command text: a later command-position `$` head can run it. Simplest safe
// rule: any command-position `$` word in any segment fails closed while such an assignment exists.
const GUARDED_PROG = /(?:^|[\s'"`;&|(])(?:git|hub|npm|pnpm|yarn|bun|npx|rm|gh|docker|lerna|changeset|semantic-release|release-it)(?:$|[\s'"`;&|)])/;
const hasGuardedAssign = (segs) => segs.some((seg) => tokens(seg).some((t) => {
  const m = /^\w+=(.+)$/s.exec(unq(t));
  return !!m && (GUARDED_PROG.test(m[1]) || m[1].split(/[\s'"]+/).some((x) => GUARDED_NOUN.test(x))); // (H3) `b="t push"` completes `a=gi`
}));

let nest = 0;
const SEG_SPLIT = /(&&|\|\||\$\(|[;&|\n(){}\x60])/;
const ENV_CHANGE = /(?:^|[\s;&|({])(?:HOME|XDG_CONFIG_HOME|PATH|PWD|OLDPWD|DOCKER_[A-Za-z0-9_]+|GIT_[A-Za-z0-9_]+)=|\bset\s+-[a-z]*a/;
const TAINT_SUBS = /^(?:checkout|switch|branch|reset|symbolic-ref|update-ref|worktree|remote|config|stash|rebase|merge|pull|fetch|restore|clone|init|am|cherry-pick|revert)$/;
const READONLY_HEADS = /^(?:cat|ls|grep|egrep|fgrep|rg|head|tail|less|more|wc|stat|file|test|\[|diff|cmp|realpath|dirname|basename|echo|printf)$/;
// null = guarded but at least one guarded part maps to no scope (never covered by a grant).
// Windows spellings read like their POSIX twins: a drive path's backslashes become slashes
// (C:\x\bin\aos-uninstall.cmd) and git.exe / GH.EXE / npm.cmd / aos-*.ps1 lose the suffix.
// Without this, gh.exe pr merge, git.exe push and a full-path aos-uninstall.cmd were free.
export function winNorm(command) {
  let s = String(command)
    .replace(/(?<![\w\\])[A-Za-z]:\\[^\s;&|'"<>]*/g, (m) => m.replace(/\\/g, "/"))
    .replace(/\b(git|gh|npm|npx|pnpx|bunx|node|aos-[\w-]+)\.(?:exe|cmd|bat|ps1)\b/gi, (_, n) => n.toLowerCase());
  // Codex on Windows wraps every command as `powershell.exe -NoProfile -Command "<cmd>"`; cmd /c does
  // the same. Read both like `bash -c`, whose quoted body the classifier already opens (Lenovo P15).
  // Only when the word is there: the path prefix would otherwise cost time on pathological input.
  if (/powershell|pwsh/i.test(s)) s = s.replace(new RegExp(String.raw`(?:"?[^\s"]{0,256}\/)?(?:powershell|pwsh)(?:\.exe)?"?((?:\s+-(?!(?:${PS_CMD})\b)[\w:]+(?:\s+(?!-)\w+)?){0,16})\s+-(?:${PS_CMD})(?=\s)`, "gi"), "bash -c");
  if (/\bcmd\b/i.test(s)) s = s.replace(/(?:"?[^\s"]{0,256}\/)?\bcmd(?:\.exe)?"?\s+\/[ck](?=\s)/gi, "bash -c");
  return s;
}

// Read-only PowerShell, judged by content: every statement head must be a known read-only command
// and nothing may write, redirect, call a method or static member, or invoke through `&`/`.`/iex.
// Anything unclear returns false and falls through to the ordinary classifier (never frees by shape).
const PS_CMDLET = /^(?:Get-\w+|Select-String|Select-Object|Where-Object|ForEach-Object|Sort-Object|Measure-Object|Group-Object|Compare-Object|Format-\w+|Out-String|Out-Null|Write-(?:Output|Host|Warning|Error)|Test-Path|Join-Path|Split-Path|Resolve-Path|Start-Sleep|Convert(?:From|To)-\w+|Invoke-(?:WebRequest|RestMethod)|gci|ls|dir|gc|cat|type|sls|select|where|sort|measure|ft|fl|iwr|irm|echo|pwd|gi|gp|gm|%|\?)$/i;
const PS_KEYWORD = /^(?:try|catch|finally|foreach|if|else|elseif|for|while|break|continue)$/i;
const PS_GIT = /^(?:log|status|diff|show|rev-parse|ls-files|describe|blame|shortlog)$/i;
const PS_METHOD = /^(?:ToString|Trim|TrimEnd|TrimStart|Split|Contains|StartsWith|EndsWith|Replace|Substring|ToLower|ToUpper|IndexOf|GetType)$/i;
const PS_OP = /^-(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|is|isnot|and|or|xor|not|replace|split|join|f|ceq|cne|ieq|ine|imatch|cmatch|as)$/i;
const PS_PLAIN = /^(?:-\S*|\$[\w:.\[\]]*|\u0001|\d+|in|\[\w.\[\]]*\])$/;

export function psReadOnly(command) {
  let t = String(command);
  const w = new RegExp(String.raw`^\s*(?:"?[^\s"]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?((?:\s+-(?!(?:${PS_CMD})\b)[\w:]+(?:\s+(?!-)\w+)?)*)\s+-(?:${PS_CMD})\s+(["'])([\s\S]*)\2\s*$`, "i").exec(t);
  if (w) t = w[2] === '"' ? w[3].replace(/\\"/g, '"') : w[3].replace(/''/g, "'");
  if (t.length > 4096) return false;
  let live = false;
  t = t.replace(/'(?:[^']|'')*'|"(?:[^"`]|"")*"/g, (m) => { if (m[0] === '"' && /\$[({]/.test(m)) live = true; return "\u0001"; });
  t = t.replace(/\b[1-6*]?>&[12]\b/g, " ").replace(/\b[1-6*]?>\s*\$null\b/gi, " ");
  if (live || /['"`&<>]|::|\$[({]|@/.test(t)) return false;
  for (const m of t.matchAll(/\.(\w+)\s*\(/g)) if (!PS_METHOD.test(m[1])) return false;
  t = t.replace(/(\$\w+)\s*[-+*/%]?=(?!=)/g, "$1 ;"); // only a plain local variable; `$x.Prop =` and `$env:X =` stay unreadable
  const queue = t.split(/[;|{}()\n\r]+/);
  let seen = 0;
  while (queue.length) {
    const frag = queue.shift().trim();
    if (!frag) continue;
    const inM = /^(\$\S+)\s+in\s+([\s\S]+)$/i.exec(frag);
    if (inM) { queue.unshift(inM[1], inM[2]); continue; }
    seen++;
    const words = frag.split(/\s+/), head = words[0];
    if (PS_KEYWORD.test(head)) { if (words.length > 1 && !/^catch$/i.test(head)) return false; continue; }
    // A variable, operator or literal statement is an expression; `$SHELL -c ...` or `"x.cmd" --yes` is a command call.
    if (/^\$[\w:.\[\]]*$/.test(head) || PS_OP.test(head)) { if (words.length > 1 && !((/^\$/.test(head) ? PS_OP.test(words[1]) : true) && words.slice(1).every((x) => PS_PLAIN.test(x)))) return false; continue; }
    if (/^git$/i.test(head)) { if (!PS_GIT.test(words[1] ?? "") || words.some((x) => /^--output/i.test(x))) return false; continue; }
    if (/^node$/i.test(head)) { if (!(/^(?:--check|-c)$/.test(words[1] ?? "") ? words.length > 2 && words.slice(2).every((x) => !x.startsWith("-")) : /^(?:-v|--version)$/.test(words[1] ?? "") && words.length === 2)) return false; continue; }
    if (!PS_CMDLET.test(head)) return false;
    if (/^(?:Invoke-(?:WebRequest|RestMethod)|iwr|irm)$/i.test(head)) {
      for (let i = 1; i < words.length; i++) {
        if (!words[i].startsWith("-")) continue;
        const [name, inline] = words[i].slice(1).split(":");
        if (/^[oib]/i.test(name)) return false;
        if (/^m/i.test(name) && !/^max/i.test(name) && !/^(?:get|head)$/i.test(inline ?? words[i + 1] ?? "")) return false;
      }
    }
  }
  return seen > 0;
}

// PowerShell takes en/em dash and horizontal bar as a parameter dash.
const normDash = (c) => (typeof c === "string" ? c.replace(/[\u2013\u2014\u2015]/g, "-") : c);

export function commandScopes(command, protectedFor = staticResolver) {
  if (nest > 3) return null;
  command = normDash(command);
  nest++;
  try {
    return withBudget(() => {
      tick();
      if (opencodeSelfPost(command)) return null;
      if (typeof command === "string" && PS_GUARDED.some((r) => r.test(command))) return null; // raw text: a powershell -Command body is quoted
      if (psReadOnly(command) && !neverGrantable(command) && !GUARDED_PATTERNS.some((r) => r.test(command))) return [];
      return scopesOf(winNorm(command), protectedFor);
    }, null);
  } finally { nest--; }
}

function scopesOf(orig, protectedFor) {
  if (commandTooLong(orig)) return null;
  const out = new Set();
  const segs = segments(orig);
  const command = unIFS(commandView(orig).text);
  // Raw text on purpose: data that a later pipe stage turns into commands must stay visible.
  if (feedsShell(segs) && catchAll(tokens(String(orig)), "", true)) return null;
  // (gatefix4 6) data fed into a shell (`| sh`, `sh <<<`) whose source is a `$` expansion
  // assigned from a guarded noun: the fed stage prints a guarded command, the raw scan above
  // cannot read it through the variable, so the whole command is unscoped. Every existing
  // feed test keeps its decision: they are guarded without an assignment as well.
  const guardedAssign = hasGuardedAssign(segs);
  if (feedsShell(segs) && guardedAssign && /[$\x60]/.test(orig)) return null;
  // Quoted opaque bodies (sh -c 'g=git; p=push; $g $p origin main') are split by the segment
  // split at the ; INSIDE the quotes; classify therefore sees fragments and the $-head rule
  // never fires. Read each -c / eval body whole here: a $/backtick/${}/$( word in command
  // position of the body fails closed (null = plain GO), whatever the fragments decide.
  for (const w of opaqueBodyWords(tokens(command))) if (cposDollar(w)) return null;
  // (gatefix4 1) `git $(echo push) origin HEAD:main`, git `echo push` origin HEAD:main`:
  // the segment split cuts at $(/backtick and classify would see a bare `git` with no
  // subcommand. A command substitution inside a git/npm/rm-family segment's words can
  // assemble the subcommand or flags, so such a segment is unscoped (plain GO).
  // scanSplit keeps $(...)/`...` whole; \u0002 is the placeholder of an inert quoted $(.
  for (const p of scanSplit(command)) {
    const tk = tokens(p.t.trim());
    if (!tk.length) continue;
    const sp = stripPrefix(tk), head = base(sp.rest[0] ?? "");
    // (H7d) command words the gate cannot read literally are guarded (plain GO): a brace group (`{git,push} x`, `git {push,}`: the
    // expansion is judged and a guarded result is never grantable), a glob head, an ANSI-C head with escapes, an alias to a guarded
    // program, `find -exec` / `watch` commands whose head is computed.
    if (tk.some((t) => t.includes("{") && BRACE.test(bareOf(t)))) {
      const ex = tk.map((t) => expandBrace(t));
      if (ex.includes(null)) return null;
      const bs = commandScopes(ex.flat().filter(Boolean).join(" "), protectedFor);
      // (H7e) a literal delete command with only brace-expanded targets (`rm -rf ~/Documents/{a,b}`) keeps its ordinary destructive verdict
      const plainDelete = DEL_CMD.test(head) && !BRACE.test(bareOf(sp.rest[0] ?? "")) && bs !== null && bs.every((x) => x === "destructive" || x === "workspace");
      if (bs === null || (bs.length && !plainDelete)) return null;
    }
    if (sp.opaque && !sp.xargs && (BRACE.test(p.t) || (/^(?:watch|parallel)$/.test(head) && /\$\(|\x60/.test(p.t))) && catchAll(sp.rest, p.t, true)) return null;
    if ((globHead(unq(sp.rest[0] ?? "")) && !(p.sep === ")" && tk.length === 1)) || /\$'[^']*\\/.test(sp.rest[0] ?? "")) return null;
    if (head === "alias" && sp.rest.slice(1).some((t) => /^[\w.-]+=/.test(unq(t)) && GUARDED_PROG.test(unq(t).replace(/^[^=]*=/, "")))) return null;
    if (head === "find") {
      const e = sp.rest.findIndex((t) => /^-(?:exec|execdir|ok|okdir)$/.test(unq(t)));
      if (e > 0 && commandScopes(sp.rest.slice(e + 1).join(" ").replace(/\s*\\?;\s*$|\s\+\s*$/, ""), protectedFor) === null) return null;
    }
    // (H7c) SEG_SPLIT cuts `$(`/backtick/`{}` before classify, so judge the glued or computed head here; a computed head's
    // quoted body is read opaque behind a neutral first word (`$X --version` stays free, `$SHELL -c 'git push ...'` does not).
    if (gluedHead(head)) return null;
    if (/^[$\x60]/.test(head)) { const r = stripPrefix(tk).rest; if (catchAll(r, p.t) || catchAll(["x", ...r.slice(1)], p.t, true)) return null; }
    // (H1) $( / backtick is live inside double quotes: walk the token, only single quotes are inert
    // (and those were already turned into placeholders). rm keeps the old rule (`rm -rf "$(pwd)/x"` stays
    // grantable-destructive); a commit message value (`commit -m "$(cat <<EOF ...)"`) is data; gh: only its
    // subcommand words count (`gh api -X PATCH $(echo ...)` is judged by its endpoint rules).
    const live = (t) => { for (let k = 0; k < t.length; k++) { if (t[k] === "\\") k++; else if (t[k] === "`" || (t[k] === "$" && t[k + 1] === "(")) return true; } return false; };
    const msgVal = (k) => /^(?:-[a-zA-Z]*m|--message)$/.test(unq(tk[k - 1] ?? "")) && tk.slice(0, 6).some((x) => unq(x) === "commit");
    if (/^(?:rm|rmx)$/.test(head)) { if (tk.some((t) => /^[^'"](?:\\.|[^'"\\])*$/.test(t) && /\$\(|\x60/.test(t))) return null; }
    else if (/^(?:git|hub|npm|pnpm|yarn|bun|npx)$/.test(head)) { if (tk.some((t, k) => live(t) && !(/^(?:git|hub)$/.test(head) && msgVal(k)))) return null; }
    else if (head === "gh") {
      let k = 1;
      while (/^(?:-R|--repo)$/.test(unq(tk[k] ?? ""))) k += 2;
      if (live(tk[k] ?? "") || (unq(tk[k] ?? "") !== "api" && live(tk[k + 1] ?? ""))) return null;
    }
  }
  // Repository state followed through the command, so a push is judged on what it will find:
  // the cwd (cd/pushd; null = unresolvable; restored at `)`), and a taint once an earlier segment
  // may have changed HEAD, the config or the branch (git checkout/branch/config/..., a write
  // under .git/) or the command assigns HOME/XDG_CONFIG_HOME/GIT_* anywhere. A tainted bare or
  // plain-name push is push-main; an explicit src:dst is still read on its own.
  const view = unIFS(commandView(orig).text);
  // gh's {owner}/{repo}/{branch} placeholders must not be cut at the braces (a placeholder is an unknown name)
  const marked = maskQuotedAmp(view).replace(REDIR, (m) => (/\.git(?:\/|$)/.test(m) ? " \u0003 " : " ")).replace(/(?<!\$)\{([a-z_]+)\}/g, "\u0004$1\u0005");
  const st = { cwd: gateCtx.cwd || process.cwd(), taint: ENV_CHANGE.test(view) };
  const stack = [];
  const outerCwd = segCwd, outerTaint = segTaint, outerFeed = segFeed, outerNoCd = segNoCd;
  // V13 H1: cd tracking cannot see `cd X | true`, `cd X &`, popd, a failing cd or CDPATH, so "$PWD" is only the session cwd when no cd appears at all.
  segNoCd = !/(?:^|[\s;&|({])(?:cd|pushd|popd)(?=[\s;&|)}]|$)|CDPATH/.test(view);
  try {
    const parts = marked.split(SEG_SPLIT);
    for (let pi = 0; pi < parts.length; pi++) {
      tick();
      if (pi % 2 === 1) {
        if (parts[pi] === "(" || parts[pi] === "$(") stack.push(st.cwd);
        else if (parts[pi] === ")" && stack.length) st.cwd = stack.pop();
        continue;
      }
      const seg = unmaskAmp(parts[pi].trim());
      if (!seg) continue;
      segCwd = st.cwd; segTaint = st.taint;
      segFeed = parts[pi - 1] === "|" ? base(stripPrefix(tokens((parts[pi - 2] ?? "").trim())).rest[0] ?? "") : "";
      // (gatefix4 2) while an assignment with a guarded noun exists anywhere in the text,
      // a command-position `$` head cannot be scoped (`c="git push"; ${=c} origin
      // HEAD:main`, a heredoc body `c="git push"; $c origin HEAD:main`).
      if (guardedAssign && (cposDollar(tokens(seg).map(base)) || /[$`\u0001\u0002]/.test(stripPrefix(tokens(seg)).rest[0] ?? ""))) return null;
      const s = classify(seg, protectedFor);
      const tk = stripPrefix(tokens(seg)).rest, h = base(tk[0] ?? "");
      if (seg.includes("\u0003")) st.taint = true;
      if (h === "git" || h === "hub") {
        let i = 1;
        while ((tk[i] ?? "").startsWith("-")) i += GIT_VALUE_OPTS.test(unq(tk[i])) ? 2 : 1;
        const sub = unq(tk[i] ?? "");
        if (sub && (TAINT_SUBS.test(sub) || !GIT_BUILTINS.test(sub))) st.taint = true;
      } else if (/^(?:cd|pushd)$/.test(h)) {
        const arg = tk.slice(1).find((x) => !/^-[LPe@]+$/.test(unq(x)));
        st.cwd = arg === undefined ? (gateCtx.home || homedir()) : resolveDir(st.cwd, arg);
        if (st.cwd === null || /(?:^|\/)\.git(?:\/|$)/.test(winSlash(st.cwd))) st.taint = true;
      } else if (!READONLY_HEADS.test(h) && tk.some((x) => /(?:^|\/)\.git(?:\/|$)/.test(unqQ(x)))) st.taint = true;
      if (s === null) return null;
      if (!s.length && GUARDED_PATTERNS.some((r) => r.test(seg))) return null;
      s.forEach((x) => out.add(x));
    }
  } finally { segCwd = outerCwd; segTaint = outerTaint; segFeed = outerFeed; segNoCd = outerNoCd; }
  // The view blanks quoted text, so a GraphQL mutation that moves or merges a ref is read on the raw command.
  if (/\bgh\b[\s\S]*?\bapi\b[\s\S]*?\bgraphql\b/.test(orig) && /\b(?:updateRef|createRef|deleteRef|createCommitOnBranch|mergePullRequest|mergeBranch|updateBranchProtectionRule)\b/.test(orig)) { out.delete("github-write"); out.add("push-main"); }
  const a = analyzeDeletes(orig);
  if (a.unscoped) return null;
  if (a.destructive) out.add("destructive");
  if (a.workspace) out.add("workspace");
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
  typeof (command = normDash(command)) === "string" && (commandTooLong(command) || neverGrantable(command) || GUARDED_PATTERNS.some((r) => r.test(commandView(command).text)) || (commandScopes(command) ?? [1]).length > 0);

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
// Read-only heads: a store path given to one of these is a read or a mere mention, never a write.
const STORE_READ = /^(?:cat|ls|grep|egrep|fgrep|head|tail|wc|stat|cd|type|get-content|gc)(?=\s|$)/i;
const STORE_NULL_REDIR = /(?:\d?>>?|&>)\s*(?:\/dev\/null|&\d)/g;
// grep here is ugrep: --pager, -Q/--query, --config, ---, --filter run or save things. Only these options pass; any other is blocked.
const GREP_SAFE_SHORT = /^[ivwxcnHhlLqsrRaEFGPzoUTbkyIABCefmdD0-9]+$/;
const GREP_SAFE_LONG = new Set(["ignore-case", "no-ignore-case", "invert-match", "word-regexp", "line-regexp", "count", "line-number", "with-filename", "no-filename", "files-with-matches", "files-without-match", "quiet", "silent", "recursive", "dereference-recursive", "include", "exclude", "exclude-dir", "include-dir", "context", "after-context", "before-context", "max-count", "extended-regexp", "fixed-strings", "basic-regexp", "perl-regexp", "only-matching", "byte-offset", "text", "null", "null-data", "label", "color", "colour", "no-messages", "regexp", "file", "binary-files", "devices", "directories", "initial-tab", "line-buffered", "no-color", "no-colour"]);
const grepArgsSafe = (args) => args.every((t) => {
  if (t === "--" || !t.startsWith("-") || t === "-") return true;
  if (t.startsWith("--")) return GREP_SAFE_LONG.has(t.slice(2).split("=")[0]);
  return GREP_SAFE_SHORT.test(t.slice(1));
});
// The segment head decides; a store-touching command must be one of these with safe options.
// Pure stdin filters after a pipe (`tail <store log> | cut -c1-200`). sort and uniq only without a file
// argument: `sort -o f`, `uniq in out` write. cut, tr and nl have no output-file option.
const STORE_FILTER = /^(?:cut|tr|nl)(?=\s|$)|^(?:sort|uniq)(?:\s+-(?!o)[\w=-]*)*\s*$/;
const storeReadSeg = (seg) => STORE_FILTER.test(seg) || (STORE_READ.test(seg) && (!/^(?:e|f)?grep(?=\s|$)/.test(seg) || grepArgsSafe(seg.split(/\s+/).slice(1))));
export function gateStoreReason(command) {
  if (typeof command !== "string") return null;
  // Backslashes are tried both ways: stripped (escape tricks like ~/\.aos/gate) and as path separators (C:\x\.aos\gate).
  const norm = command.replace(/["'\\]/g, "").replace(/\/(?:\.?\/)+/g, "/");
  const slashed = command.replace(/\\/g, "/");
  const touched = (t) => {
    // `cd <anything>/.aos` followed by a relative gate/ or go/ path (`cd ~/.aos && rm gate/x`).
    const cd = /\bcd\s+\S*\.aos\/*\s*(?:&&|;|\|\||\n)([\s\S]*)$/i.exec(t);
    return STORE_REF.test(t) || (!!cd && /(?:^|[\s>])(?:gate|go)(?:\/|\s*$)/.test(cd[1]));
  };
  if (slashed !== command && !touched(norm) && !touched(slashed.replace(/["']/g, "").replace(/\/(?:\.?\/)+/g, "/"))) return null;
  // Judge write targets, not the argument text (audit P1-11): quoted search patterns of
  // grep/echo/... and print-only heredoc bodies that merely mention the store are stripped
  // by commandView before the path is looked at again. Interpreter code (node -e, python
  // heredocs) is kept fail-closed: a store path inside it blocks whatever the surrounding text is.
  const why = "Blocked by go-gate: the GO/grant store (~/.aos/gate, ~/.aos/go) is written only by the AOS hooks. Grants come from the human typing `gogate grant ...`; read-only cat/ls/grep/head/tail/wc/stat with plain options, and a redirect to /dev/null, are allowed.";
  if (!touched(norm)) { if (touched(slashed.replace(/["']/g, "").replace(/\/(?:\.?\/)+/g, "/"))) return gateStoreReason(slashed); return null; }
  const view = commandView(command, true);
  let judged = view.text;
  for (const c of view.code) judged += "\n" + c.body;
  const vnorm = judged.replace(/["'\\]/g, "").replace(/\/(?:\.?\/)+/g, "/").replace(/\\/g, "/");
  if (!touched(vnorm)) {
    // A redirection whose target spells the store blocks even when blankData hid the target
    // inside a quoted argument of a data head (`printf x > "$HOME/.aos/gate/y"`): taken from
    // the quote-stripped raw text. Redirect targets, not argv text.
    for (const m of norm.matchAll(REDIR)) if (STORE_REF.test(m[0]) && !/\/dev\/null|&\d/.test(m[0])) return why;
    return null;
  }
  // Command and process substitution run commands of their own.
  if (/\$\(|\x60|<\(|>\(/.test(vnorm)) return why;
  const plain = vnorm.replace(STORE_NULL_REDIR, "");
  // Any other redirect or --output writes a file that may be the store.
  if (/>/.test(plain) || /--output\b/.test(plain)) return why;
  // No env-assignment prefix is stripped: `PATH=/tmp/x cat ...` or `LD_PRELOAD=...` is not a read-only head and blocks.
  const readOnly = plain.split(/&&|\|\||[;|&\n]/).every((s) => {
    const seg = s.trim();
    return !seg || storeReadSeg(seg);
  });
  return readOnly ? null : why;
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
  // A planted non-regular marker (FIFO/device/dir/symlink/oversize) fails closed: the cooldown window is always open. Missing = 0.
  const txt = readSmallRegular(blockFile(key), 4096);
  if (txt === false) return Date.now() - (COOLDOWN_MS >> 1);
  try { return Math.min(Number(JSON.parse(txt ?? "")?.ts) || 0, Date.now()); } catch { return 0; }
}
// Never blocks or follows a link: a planted FIFO/device/symlink must not hang the hook (fail-open).
// null = missing, false = not a small regular file, else the text. follow=true keeps a symlink to a regular file readable (the fstat still rejects a FIFO/device behind it).
export function readSmallRegular(f, max, follow = false) {
  let fd;
  try {
    fd = openSync(f, FS.O_RDONLY | FS.O_NONBLOCK | (follow ? 0 : FS.O_NOFOLLOW));
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return false;
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) { const k = readSync(fd, buf, n, st.size - n, n); if (!k) break; n += k; }
    return buf.toString("utf8", 0, n);
  } catch (e) { return e.code === "ENOENT" ? null : false; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
}
// Regular-file text or a throw (callers keep their catch): FIFO, device, oversize and missing all throw.
function mustRead(f, max) {
  const t = readSmallRegular(f, max, true);
  if (typeof t !== "string") throw new Error("not a small regular file");
  return t;
}
// A path an external reader (sqlite) will open: only a regular file, so a planted FIFO cannot hang it.
function isRegularFile(p) { try { return statSync(p).isFile(); } catch { return false; } }
// sqlite also opens the WAL/SHM/journal sidecars (blocking open): each must be absent or a regular file.
// The db itself must not be a symlink either: sqlite would open the sidecars next to the link target, unchecked.
const sqliteSafe = (p) => { try { if (!lstatSync(p).isFile()) return false; } catch { return false; } return ["-wal", "-shm", "-journal"].every((s) => { try { return lstatSync(p + s).isFile(); } catch (e) { return e.code === "ENOENT"; } }); };
export function writeNoHang(f, data, flags) {
  const fd = openSync(f, FS.O_WRONLY | FS.O_CREAT | FS.O_NOFOLLOW | FS.O_NONBLOCK | flags, 0o600);
  try { writeFileSync(fd, data); } finally { closeSync(fd); }
}
export function markBlock(key, now = Date.now()) {
  if (!key || now - readBlockTs(key) < COOLDOWN_MS) return;
  try {
    mkdirSync(gateDir(), { recursive: true, mode: 0o700 });
    writeNoHang(blockFile(key), JSON.stringify({ ts: now }), FS.O_TRUNC);
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

const TEST_RUN = /\bnode(?:js)?\s+(?:-\S+\s+)*--test\b|\bnpm\s+(?:run\s+)?test\b|\bnpx\s+(?:-\S+\s+)*(?:vitest|jest|mocha)\b|\bpytest\b/i;
export const TEST_HINT = "Test runs: use the Docker container (AOS_TEST_SANDBOX=container), see docs/codex-gate-smoke.md";
// Denied commands are the likeliest to carry inline credentials. Masked before truncation so a
// secret cut at the boundary cannot survive. ponytail: pattern list, not a parser; extend on leaks.
const SECRET_NAME = /(?:TOKEN|SECRET|PASS(?:WORD|WD)?|PWD|API_?KEY|AUTH|CREDENTIALS?|PRIVATE_?KEY)/i;
export function maskSecrets(text) {
  return String(text ?? "")
    .replace(/(\b[A-Za-z_]\w*=)("[^"]*"|'[^']*'|\S+)/g, (m, k, v) => (SECRET_NAME.test(k) || v.replace(/^["']|["']$/g, "").length >= 12 ? `${k}***` : m))
    .replace(/\b(Bearer|token|Basic)\s+[^\s"']+/gi, "$1 ***")
    .replace(/(--?(?:token|password|passwd|secret|api-?key|auth)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, "$1***")
    .replace(/(\s-u\s+)[^\s:]+:\S+/g, "$1***")
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[abprs]-|glpat-|AKIA)[A-Za-z0-9_-]{6,}/g, "***")
    .replace(/(:\/\/)[^\s/]*@/g, "$1***@")
    .replace(/(authorization[:=]\s*)(?!\*\*\*)[^\s"']+(\s+[^\s"']+)?/gi, "$1***");
}

// Codex PreToolUse payloads carry turn_id plus a .codex transcript or a permission_mode.
export function isCodexPayload(input) {
  return !!input && typeof input === "object" && !!input.turn_id &&
    ((typeof input.transcript_path === "string" && input.transcript_path.includes(".codex")) || typeof input.permission_mode === "string");
}
let codexMode = false;
let toolNameSeen = "";

// Single exit: opt-in decision log (AOS_GATE_DEBUG, absolute path) at the moment of exit.
function leave(code, decision, reason = "") {
  const dbg = process.env.AOS_GATE_DEBUG;
  if (dbg && isAbsolute(dbg)) {
    try { appendFileSync(dbg, `${JSON.stringify({ ts: new Date().toISOString(), tool_name: toolNameSeen, decision, exit: code, ...(reason ? { reason: maskSecrets(reason).slice(0, 500) } : {}) })}\n`); } catch { /* debug only */ }
  }
  process.exit(code);
}

// Codex honours exactly this deny shape (plus exit 2 + stderr); any other stdout field marks the hook failed and the tool call runs.
function codexDeny(reason) {
  const out = `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } })}\n`;
  try { writeFileSync(1, out); } catch { process.stdout.write(out); }
  process.stderr.write(`${reason}\n`);
  leave(2, "deny", reason);
}

function respond(isAgy, allowed, reason = "", command = "", hard = false) {
  if (!allowed) markBlock(blockKey);
  if (!allowed && !hard && TEST_RUN.test(command)) reason = `${reason} ${TEST_HINT}`.trim();
  // Every deny leaves the command as the gate saw it; without this a block cannot be reproduced.
  if (!allowed && blockKey) {
    let why = "", sc = null;
    try { const r = commandScopes(command); sc = r ? [...r].sort() : null; why = `guarded=${isGuardedCommand(command)} scopes=${JSON.stringify(r)}`; } catch { why = "classify failed"; }
    gateLog(blockKey, `deny${hard ? " hard" : ""} ${why} ${JSON.stringify(maskSecrets(command).slice(0, 200))} :: ${maskSecrets(reason).slice(0, 120)}`);
    recordRequest(blockKey, command, sc, hard);
  }
  const claudeText = `Blocked by go-gate hook: command "${command.slice(0, 80)}" requires a fresh, literal "GO" as your last message. ${reason}`;
  if (codexMode && !isAgy) {
    if (allowed) leave(0, "allow");
    codexDeny(hard ? `[MECHANICAL GO-GATE BLOCKED] ${reason}` : claudeText);
  }
  if (hard) {
    console.log(JSON.stringify({ decision: "deny", reason: `[MECHANICAL GO-GATE BLOCKED] ${reason}` }));
    process.stderr.write(`${reason}\n`);
    leave(isAgy ? 0 : 2, "deny", reason);
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
    leave(0, allowed ? "allow" : "deny", reason);
  } else {
    // Claude Code harness
    if (allowed) {
      leave(0, "allow");
    } else {
      process.stderr.write(`${claudeText}\n`);
      leave(2, "deny", reason);
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
// Limits are fail-closed: exceeding one throws SCANLIMIT (never skips data), and every caller turns a throw into a deny.
const MAX_LINE = 64 << 20;
const MAX_SCAN = 512 << 20; // reverse scan budget
const MAX_SCAN_FWD = 1024 << 20; // forward scan budget (a planted sparse transcript must not run the hook into its timeout)
// Wall-clock limit, well inside the hook timeout: per scan, and per hook call once main() sets hookDeadline.
// Never measured from process start: long-lived importers (OpenCode plugin, hub, aos-acp) scan transcripts too.
const SCAN_MS = 20000;
let hookDeadline = Infinity;
const scanLimit = () => Object.assign(new Error("transcript scan limit exceeded"), { code: "SCANLIMIT" });
function openTranscript(path) {
  const fd = openSync(path, FS.O_RDONLY | FS.O_NONBLOCK);
  try { if (!fstatSync(fd).isFile()) throw new Error("transcript is not a regular file"); } catch (e) { closeSync(fd); throw e; }
  return fd;
}
export function* fileLines(path) {
  const fd = openTranscript(path);
  try {
    const buf = Buffer.alloc(CHUNK);
    const deadline = Math.min(hookDeadline, Date.now() + SCAN_MS);
    let parts = [], plen = 0, total = 0; // pieces of the line still open at the end of the last chunk
    for (let n; (n = readSync(fd, buf, 0, CHUNK, null)) > 0;) {
      if ((total += n) > MAX_SCAN_FWD || Date.now() > deadline) throw scanLimit();
      const chunk = buf.subarray(0, n);
      let start = 0;
      for (let i; (i = chunk.indexOf(10, start)) !== -1; start = i + 1) {
        if (i === start && !parts.length) continue; // empty line
        const piece = chunk.subarray(start, i);
        const line = parts.length ? Buffer.concat([...parts, piece]) : piece;
        parts = []; plen = 0;
        if (line.length) yield line.toString("utf8");
      }
      if (start < n) {
        plen += n - start;
        if (plen > MAX_LINE) throw scanLimit();
        parts.push(Buffer.from(chunk.subarray(start)));
      }
    }
    if (plen) yield Buffer.concat(parts).toString("utf8");
  } finally { closeSync(fd); }
}
function* fileLinesReverse(path) {
  const fd = openTranscript(path);
  try {
    let pos = fstatSync(fd).size;
    const deadline = Math.min(hookDeadline, Date.now() + SCAN_MS);
    let parts = [], plen = 0, scanned = 0; // pieces of the line still open at the start of the last chunk
    while (pos > 0) {
      if (scanned >= MAX_SCAN || Date.now() > deadline) throw scanLimit();
      const len = Math.min(CHUNK, pos);
      pos -= len;
      scanned += len;
      const b = Buffer.alloc(len);
      readSync(fd, b, 0, len, pos);
      let end = len;
      for (let i; end > 0 && (i = b.lastIndexOf(10, end - 1)) !== -1; end = i) {
        const piece = b.subarray(i + 1, end);
        const line = parts.length ? Buffer.concat([piece, ...parts]) : piece;
        parts = []; plen = 0;
        if (line.length) yield line.toString("utf8");
      }
      if (end > 0) {
        plen += end;
        if (plen > MAX_LINE) throw scanLimit();
        parts.unshift(b.subarray(0, end));
      }
    }
    if (plen) yield Buffer.concat(parts).toString("utf8");
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
  return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(raw) && !/\.(req|revoke)$|^trail-credential$/.test(raw) ? raw : `${slug(raw).replace(/^\.+/, "").slice(0, 64) || "s"}-${createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
};
export const statePath = (key) => join(gateDir(), `${key}.json`);

export function readState(key) {
  try { return JSON.parse(mustRead(statePath(key), 256 * 1024)); } catch { return null; }
}
export function writeState(key, state) {
  mkdirSync(gateDir(), { recursive: true, mode: 0o700 });
  const tmp = `${statePath(key)}.${process.pid}.tmp`;
  writeNoHang(tmp, JSON.stringify(state, null, 2), FS.O_TRUNC);
  renameSync(tmp, statePath(key));
}
const LOG_MAX = 256 * 1024, LOG_KEEP = 500;
export function gateLog(key, line) {
  try {
    mkdirSync(gateDir(), { recursive: true, mode: 0o700 });
    const f = join(gateDir(), `${key}.log`);
    writeNoHang(f, `${new Date().toISOString()} ${String(line).slice(0, 400).replace(/[\r\n]+/g, " ")}\n`, FS.O_APPEND);
    if (statSync(f).size > LOG_MAX) { const t = readSmallRegular(f, 16 << 20, true); writeNoHang(f, typeof t === "string" ? t.split("\n").filter(Boolean).slice(-LOG_KEEP).join("\n") + "\n" : "", FS.O_TRUNC); }
  } catch { /* logging never blocks */ }
}

// Structured deny records for the trail hub: <gate dir>/<key>.req.json, a JSON array of the last
// 20 denies. Best effort and after the decision is fixed: any failure is swallowed.
const REQ_KEEP = 20;
export function recordRequest(key, command, scopes, hard) {
  try {
    const f = join(gateDir(), `${key}.req.json`);
    let all = [];
    const txt = readSmallRegular(f, 64 * 1024);
    if (txt === false) return;
    try { const a = JSON.parse(txt ?? "[]"); if (Array.isArray(a)) all = a; } catch { /* corrupt: start over */ }
    const preview = maskSecrets(command).slice(0, 200);
    all.push({
      id: randomUUID(), ts: new Date().toISOString(), session_key: key, session_name: process.env.AOS_SESSION_NAME || "",
      cwd: gateCtx.cwd || "", cmd_hash: textHash(command), cmd_preview: preview, scopes: scopes ?? null, hard: !!hard, click: !hard && clickEligible(command),
    });
    mkdirSync(gateDir(), { recursive: true, mode: 0o700 });
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all.slice(-REQ_KEEP), null, 2), { mode: 0o600, flag: "wx" });
    renameSync(tmp, f);
  } catch { /* the record never changes the decision */ }
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
  } catch (e) { if (e.code === "SCANLIMIT") throw e; return []; } // safeMain denies on a throw
  return out;
}

const WEAK_HINT = "it came from a slash command, which Claude Code stores without human-origin data; type the plain form as the whole message instead, e.g. `gogate grant merge 2h` or `gogate off`";
const OC_HINT = "OpenCode accepts only the plain form (`gogate off`, `gogate grant merge 2h`) typed as the whole message";

// Resolves mode and active grants for a session, verified against `cmds` (gogate commands
// of the session, oldest first, each marked `strict` when it has human-origin evidence).
// `source` is the transcript path (Claude) or "opencode:<sessionID>"; store entries for
// another source are rejected. Rules:
// - The mode is the latest usable mode command of the TRANSCRIPT: any `hard` (tightening
//   needs no proof), or a strict `soft`/`off`. A non-strict soft/off is ignored and leaves
//   the previous mode. soft/off also need their own store entry (written by go-grant), else hard.
// - OpenCode has no human-origin signal at all (a prompt posted through the HTTP API is a
//   plain text part), so there only the plain form counts (and the known agent routes that
//   post a prompt are blocked); `off` and grants behave like on Claude.
// - Grants need a strict entry after the last hard; `until` is clamped to the typed duration.
export function effectiveGate(key, { source, cmds, opencode = false }, now = Date.now()) {
  const st = readState(key);
  const state = st && typeof st === "object" ? st : {};
  const rejected = [];
  const usable = (c) => c.parsed.cmd === "hard" || c.strict;
  for (const c of cmds) {
    if (["soft", "off"].includes(c.parsed.cmd) && !usable(c)) {
      rejected.push(`mode ${c.parsed.cmd} ignored: ${opencode ? OC_HINT : WEAK_HINT}`);
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
  // A revoke file from the trail UI acts like a `hard` typed at its timestamp: tightening only, no proof needed.
  const revokeTs = readRevokeTs(key, now);
  if (revokeTs && mode !== "hard" && !(lastMode && Number.isFinite(lastMode.ts) && lastMode.ts > revokeTs)) {
    mode = "hard";
    rejected.push("revoked from the trail UI");
  }
  const lastHard = cmds.findLastIndex((c) => c.parsed.cmd === "hard");
  const grants = [];
  for (const g of Array.isArray(state.grants) ? state.grants : []) {
    const c = match(g?.source, (p) => p.cmd === "grant" && p.scopes.includes(g?.scope));
    if (!c) { rejected.push(`grant ${g?.scope} has no matching human gogate entry`); continue; }
    if (!c.strict) { rejected.push(`grant ${g?.scope} ignored: ${opencode ? OC_HINT : WEAK_HINT}`); continue; }
    if (cmds.indexOf(c) < lastHard) { rejected.push(`grant ${g.scope} revoked by a later hard`); continue; }
    if (revokeTs && !(Number.isFinite(c.ts) && c.ts > revokeTs)) { rejected.push(`grant ${g.scope} revoked from the trail UI`); continue; }
    if (c.parsed.session && g.session_key !== key) { rejected.push(`session grant ${g.scope} belongs to another session`); continue; }
    const until = Math.min(Date.parse(g.until), c.ts + c.parsed.ms);
    if (!(now < until)) continue; // expired
    grants.push({ scope: g.scope, until, session: !!c.parsed.session });
  }
  const hardTs = lastHard >= 0 ? (Number.isFinite(cmds[lastHard].ts) ? cmds[lastHard].ts : Infinity) : -Infinity;
  grants.push(...clickGrants(key, now, { opencode, hardTs, revokeTs }), ...localClickGrants(key, now, { opencode, hardTs, revokeTs }));
  return { mode, grants, rejected };
}

export const grantsCover = (command, grants, protectedFor) => {
  const need = commandScopes(command, protectedFor);
  // A destructive grant has always covered a repo script that deletes; the narrower `workspace` scope (the same script, in the
  // session's own repo, every delete target inside it) is therefore covered by either grant.
  return !!need && need.length > 0 && need.every((s) => grants.some((g) => g.scope === s || (s === "workspace" && g.scope === "destructive")));
};

export function statusText(key, eff, now = Date.now()) {
  const lines = [`AOS go-gate, session ${key}: mode ${eff.mode}`];
  if (!eff.grants.length) lines.push("  no active grants");
  for (const g of eff.grants) lines.push(`  grant ${g.scope} until ${new Date(g.until).toISOString()} (${Math.ceil((g.until - now) / 60000)} min left${g.session ? "; session = this session id, max 24h, survives --resume" : ""})`);
  for (const r of [...new Set(eff.rejected)].slice(0, 5)) lines.push(`  ignored: ${r}`);
  return lines.join("\n");
}

export const listStateKeys = () => {
  try { return readdirSync(gateDir()).filter((f) => f.endsWith(".json") && !/\.(req|revoke)\.json$|^trail-credential\.json$/.test(f)).map((f) => f.slice(0, -5)); } catch { return []; }
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
  } catch (e) { if (e.code === "SCANLIMIT") throw e; /* unreadable */ }
  return name || process.env.AOS_SESSION_NAME || "";
}

const CONSUMED_KEEP = 200;
const consumedFile = () => join(homedir(), ".aos", "go", ".consumed");
const readConsumed = () => {
  const t = readSmallRegular(consumedFile(), 1 << 20, true);
  return t === null ? [] : t === false ? null : t.split("\n").filter(Boolean);
};

function opencodeLastUser(sessionId) {
  let db;
  try {
    const dbPath = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "opencode.db");
    if (typeof sessionId !== "string" || !sqliteSafe(dbPath)) return null;
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
    if (typeof sessionId !== "string" || !sqliteSafe(dbPath)) return [];
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
    tok = JSON.parse(mustRead(file, 64 * 1024));
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
      writeNoHang(consumedFile(), [...consumed, key].slice(-CONSUMED_KEEP).join("\n") + "\n", FS.O_TRUNC);
      unlinkSync(file);
    } catch { return { ok: false, reason: "could not consume GO token" }; }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Click receipts (WP-9). The trail hub writes <go dir>/<key>.click-<request id>.json = {payload, assertion}
// after a WebAuthn click. Nothing the hub says is trusted: the gate re-verifies the assertion itself against the
// public key pinned in <gate dir>/trail-credential.json. Every failure means "not covered" (the existing deny stands).
// ---------------------------------------------------------------------------
const CLICK_RP_ID = "localhost";
const CLICK_ORIGIN = /^http:\/\/localhost:[0-9]{1,5}$/;
const CLICK_KEY = /^[a-z0-9._-]{1,128}$/;
const CLICK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
// The gate never removes receipts or their `.used` markers (it deletes nothing); pruning old ones is the hub's job. The scan
// is bounded (CLICK_SCAN entries, CLICK_MAX_FILES matches), so a pile-up can only make receipts unusable, never unsafe.
const CLICK_FILE_MAX = 16 * 1024, CLICK_CRED_MAX = 4096, CLICK_SCAN = 4096, CLICK_MAX_FILES = 32;
const PAYLOAD_KEYS = ["v", "kind", "request_id", "session_key", "cmd_hash", "scopes", "ms", "issued_at", "expires_at", "nonce"];
const sha256 = (data) => createHash("sha256").update(data).digest();
const goDir = () => join(homedir(), ".aos", "go");

function b64uDecode(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= max && B64U.test(v) ? Buffer.from(v, "base64url") : null;
}

// Regular file, owned by this uid, mode exactly 0600, never followed, never blocking. null on anything else.
function readOwnedPrivate(f, max) {
  let fd;
  try {
    if (process.platform === "win32" && lstatSync(f).isSymbolicLink()) return null; // O_NOFOLLOW is a no-op on Windows
    fd = openSync(f, FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > max) return null;
    // POSIX owner/mode only: Windows has no uid and reports 0666; the per-user profile ACL is the equivalent there.
    // ponytail: win32 trusts the profile ACL; an icacls/SID check (cached by mtime) is the 5.1 upgrade if that matters.
    if (process.platform !== "win32" && (typeof process.getuid !== "function" || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600)) return null;
    const buf = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) { const k = readSync(fd, buf, n, st.size - n, n); if (!k) break; n += k; }
    return n === st.size ? buf.toString("utf8") : null;
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
}

// Fixed key order, identical to the hub's canonicalPayload; the challenge is base64url(sha256(this)).
export const clickPayloadOk = (p) =>
  !!p && typeof p === "object" && !Array.isArray(p) && Object.keys(p).length === PAYLOAD_KEYS.length && PAYLOAD_KEYS.every((k) => Object.hasOwn(p, k)) &&
  p.v === 1 && (p.kind === "go" || p.kind === "grant") && typeof p.request_id === "string" && CLICK_ID.test(p.request_id) &&
  typeof p.session_key === "string" && CLICK_KEY.test(p.session_key) && typeof p.cmd_hash === "string" && /^(?:[0-9a-f]{64})?$/.test(p.cmd_hash) &&
  (p.scopes === null ? p.kind === "go" : Array.isArray(p.scopes) && p.scopes.length <= 16 && p.scopes.every((s) => typeof s === "string" && s.length <= 32)) &&
  Number.isSafeInteger(p.ms) && p.ms >= 0 && Number.isSafeInteger(p.issued_at) && Number.isSafeInteger(p.expires_at) && typeof p.nonce === "string" && p.nonce.length <= 64;
export const clickChallenge = (p) => sha256(JSON.stringify({
  v: 1, kind: p.kind, request_id: p.request_id, session_key: p.session_key, cmd_hash: p.cmd_hash, scopes: p.scopes,
  ms: p.ms, issued_at: p.issued_at, expires_at: p.expires_at, nonce: p.nonce,
})).toString("base64url");

// credential = {id, publicKey: JWK P-256}; assertion = {id, authenticatorData, clientDataJSON, signature} (base64url, DER signature).
// Never throws. The signature counter is not checked: a receipt is single-use by request_id, and a counter check would deny
// legitimate receipts that are clicked out of order.
export function verifyWebAuthnAssertion({ credential, assertion, expectedChallenge, origin, rpId = CLICK_RP_ID } = {}) {
  const no = (reason) => ({ ok: false, reason });
  try {
    if (!credential || typeof credential !== "object" || !assertion || typeof assertion !== "object") return no("malformed input");
    if (typeof expectedChallenge !== "string" || !expectedChallenge || typeof origin !== "string" || !origin || typeof rpId !== "string" || !rpId) return no("malformed input");
    const jwk = credential.publicKey;
    if (!jwk || typeof jwk !== "object" || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") return no("bad credential key");
    if (typeof credential.id !== "string" || !credential.id || assertion.id !== credential.id) return no("wrong credential");
    const authData = b64uDecode(assertion.authenticatorData, 1400), cd = b64uDecode(assertion.clientDataJSON, 4096), sig = b64uDecode(assertion.signature, 200);
    if (!authData || !cd || !sig) return no("bad encoding");
    if (authData.length < 37) return no("short authenticator data");
    let clientData;
    try { clientData = JSON.parse(cd.toString("utf8")); } catch { return no("bad client data"); }
    if (!clientData || typeof clientData !== "object" || Array.isArray(clientData)) return no("bad client data");
    if (clientData.type !== "webauthn.get") return no("wrong type");
    if (clientData.challenge !== expectedChallenge) return no("challenge mismatch");
    if (clientData.origin !== origin || clientData.crossOrigin === true) return no("wrong origin");
    if (!timingSafeEqual(authData.subarray(0, 32), sha256(rpId))) return no("wrong rpIdHash");
    if (!(authData[32] & 0x01)) return no("user presence missing");
    if (!(authData[32] & 0x04)) return no("user verification missing");
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
    if (!cryptoVerify("sha256", Buffer.concat([authData, sha256(cd)]), { key, dsaEncoding: "der" }, sig)) return no("bad signature");
    return { ok: true, signCount: authData.readUInt32BE(33) };
  } catch { return no("verification error"); }
}

// Minimal CBOR for an attestationObject: unsigned/negative ints, byte strings, text strings, maps. Definite lengths up to
// 32 bit only; arrays, tags, floats, simple values, indefinite lengths, duplicate keys and deep nesting all throw.
const CBOR_DEPTH = 4, CBOR_ITEMS = 16, CBOR_MAX = 4096;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
function cborItem(buf, off, depth) {
  if (depth > CBOR_DEPTH || off >= buf.length) throw new Error("cbor");
  const ib = buf[off++], major = ib >> 5, ai = ib & 31;
  let n;
  if (ai < 24) n = ai;
  else if (ai === 24) { if (off + 1 > buf.length) throw new Error("cbor"); n = buf[off++]; }
  else if (ai === 25) { if (off + 2 > buf.length) throw new Error("cbor"); n = buf.readUInt16BE(off); off += 2; }
  else if (ai === 26) { if (off + 4 > buf.length) throw new Error("cbor"); n = buf.readUInt32BE(off); off += 4; }
  else throw new Error("cbor");
  if (major === 0) return [n, off];
  if (major === 1) return [-1 - n, off];
  if (major === 2 || major === 3) {
    if (off + n > buf.length) throw new Error("cbor");
    const raw = buf.subarray(off, off + n);
    return [major === 2 ? raw : UTF8.decode(raw), off + n];
  }
  if (major === 5) {
    if (n > CBOR_ITEMS) throw new Error("cbor");
    const m = new Map();
    for (let i = 0; i < n; i += 1) {
      const [k, o1] = cborItem(buf, off, depth + 1);
      if ((typeof k !== "number" && typeof k !== "string") || m.has(k)) throw new Error("cbor");
      const [v, o2] = cborItem(buf, o1, depth + 1);
      m.set(k, v);
      off = o2;
    }
    return [m, off];
  }
  throw new Error("cbor");
}

// attestationObject (Buffer or base64url) with fmt "none" -> {credentialId, publicKey: JWK}; null for anything malformed.
export function parseCoseKey(attestationObject) {
  try {
    const buf = typeof attestationObject === "string" ? b64uDecode(attestationObject, 8192) : attestationObject instanceof Uint8Array ? Buffer.from(attestationObject) : null;
    if (!buf || buf.length > CBOR_MAX) return null;
    const [top, end] = cborItem(buf, 0, 0);
    if (end !== buf.length || !(top instanceof Map) || top.get("fmt") !== "none") return null;
    const stmt = top.get("attStmt"), ad = top.get("authData");
    if (!(stmt instanceof Map) || stmt.size !== 0 || !Buffer.isBuffer(ad) || ad.length < 55 || !(ad[32] & 0x40)) return null;
    const idLen = ad.readUInt16BE(53);
    if (idLen < 1 || idLen > 1023 || 55 + idLen >= ad.length) return null;
    const [cose, cend] = cborItem(ad, 55 + idLen, 0);
    if (!(cose instanceof Map) || (cend !== ad.length && !(ad[32] & 0x80))) return null;
    const x = cose.get(-2), y = cose.get(-3);
    if (cose.size !== 5 || cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) return null;
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) return null;
    const publicKey = { kty: "EC", crv: "P-256", x: x.toString("base64url"), y: y.toString("base64url") };
    createPublicKey({ key: publicKey, format: "jwk" }); // throws when the point is not on the curve
    return { credentialId: ad.subarray(55, 55 + idLen).toString("base64url"), publicKey };
  } catch { return null; }
}

function readClickCredential() {
  const txt = readOwnedPrivate(join(gateDir(), "trail-credential.json"), CLICK_CRED_MAX);
  if (!txt) return null;
  try {
    const c = JSON.parse(txt);
    return c && c.v === 1 && typeof c.id === "string" && c.id && c.publicKey && typeof c.origin === "string" && CLICK_ORIGIN.test(c.origin) ? c : null;
  } catch { return null; }
}

// Tightening marker: <gate dir>/<key>.revoke.json {ts}. Present but unreadable or malformed counts as "revoked now".
function readRevokeTs(key, now) {
  try {
    if (typeof key !== "string" || !CLICK_KEY.test(key)) return 0;
    // max(ts in the file, ctime of the file): overwriting a revoke file can only move it later, never reopen grants.
    let fd, txt, mtime;
    try {
      fd = openSync(join(gateDir(), `${key}.revoke.json`), FS.O_RDONLY | FS.O_NOFOLLOW | FS.O_NONBLOCK);
      const st = fstatSync(fd);
      if (!st.isFile() || st.size > 1024) return now;
      mtime = st.ctimeMs; // utimes() can set mtime backwards, never ctime
      const buf = Buffer.alloc(st.size);
      let n = 0;
      while (n < st.size) { const k = readSync(fd, buf, n, st.size - n, n); if (!k) break; n += k; }
      txt = buf.toString("utf8", 0, n);
    } catch (e) { return e.code === "ENOENT" ? 0 : now; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
    let ts = NaN;
    try { ts = Date.parse(JSON.parse(txt)?.ts); } catch { /* malformed: mtime alone decides */ }
    return Math.min(Math.max(Number.isFinite(ts) ? ts : now, mtime), now);
  } catch { return now; }
}

function clickNames(prefix) {
  const out = [];
  let d;
  try {
    d = opendirSync(goDir());
    for (let i = 0, e; i < CLICK_SCAN && out.length < CLICK_MAX_FILES && (e = d.readSync()); i += 1) {
      if (e.name.startsWith(prefix) && e.name.endsWith(".json")) out.push(e.name);
    }
  } catch { /* no dir: no receipts */ } finally { try { d?.closeSync(); } catch { /* ignore */ } }
  return out;
}

// Reads and shape-checks one receipt; the file name must be exactly <key>.click-<payload.request_id>.json.
function loadReceipt(key, name) {
  const txt = readOwnedPrivate(join(goDir(), name), CLICK_FILE_MAX);
  if (!txt) return null;
  try {
    const r = JSON.parse(txt);
    const p = r?.payload;
    if (!clickPayloadOk(p) || p.session_key !== key || name !== `${key}.click-${p.request_id}.json` || !r.assertion || typeof r.assertion !== "object") return null;
    return { payload: p, assertion: r.assertion };
  } catch { return null; }
}

function receiptValid(rec, cred, now) {
  const p = rec.payload;
  const cap = p.kind === "go" ? TOKEN_TTL_MS : MAX_GRANT_MS;
  if (p.issued_at > now || !(now < p.expires_at) || p.expires_at - p.issued_at > cap) return false;
  return verifyWebAuthnAssertion({ credential: cred, assertion: rec.assertion, expectedChallenge: clickChallenge(p), origin: cred.origin }).ok;
}

// Single use: the id goes into the shared consumed list (append + trim, like tokens) and an O_EXCL marker closes the race
// between two gates holding the same receipt.
function claimClick(key, id) {
  const tag = `click-${id}`;
  const txt = readSmallRegular(consumedFile(), 64 * 1024);
  if (txt === false) return false;
  const consumed = (txt ?? "").split("\n").filter(Boolean);
  if (consumed.includes(tag)) return false;
  let fd;
  try {
    fd = openSync(join(goDir(), `${key}.click-${id}.json.used`), FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | FS.O_NOFOLLOW | FS.O_NONBLOCK, 0o600);
  } catch { return false; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* ignore */ } }
  try {
    writeNoHang(consumedFile(), [...consumed, tag].slice(-CONSUMED_KEEP).join("\n") + "\n", FS.O_TRUNC);
    return true;
  } catch { return false; }
}

// A receipt that was already claimed (marker or consumed list); anything unreadable counts as spent.
function clickSpent(key, id) {
  const txt = readSmallRegular(consumedFile(), 64 * 1024);
  if (txt === false || (txt ?? "").split("\n").includes(`click-${id}`)) return true;
  try { lstatSync(join(goDir(), `${key}.click-${id}.json.used`)); return true; } catch (e) { return e.code !== "ENOENT"; }
}

// What a human can fully see and approve in the UI preview: short, printable ASCII, already in normal form (textHash
// collapses whitespace) and free of anything maskSecrets would hide. recordRequest publishes the same predicate as `click`.
export const clickEligible = (command) =>
  typeof command === "string" && command.length > 0 && command.length <= 200 && /^[\x20-\x7e]+$/.test(command) &&
  command === normalizeCommandText(command) && maskSecrets(command) === command;

export function clickReceiptCovers(command, key, { now = Date.now(), consume = true } = {}) {
  try {
    if (typeof command !== "string" || !command.trim() || typeof key !== "string" || !CLICK_KEY.test(key)) return false;
    // textHash collapses whitespace, so only a command that is already in normal form may be covered: a multi-line or
    // whitespace-variant command needs a typed GO.
    if (!clickEligible(command)) return false;
    const names = clickNames(`${key}.click-`);
    if (!names.length) return false;
    const cred = readClickCredential();
    if (!cred) return false;
    const want = textHash(command);
    const revokeTs = readRevokeTs(key, now);
    for (const name of names) {
      const rec = loadReceipt(key, name);
      const p = rec?.payload;
      if (!p || p.kind !== "go" || p.cmd_hash !== want || p.issued_at <= revokeTs || !receiptValid(rec, cred, now)) continue;
      if (clickSpent(key, p.request_id)) continue;
      if (!consume) return true;
      if (claimClick(key, p.request_id)) return true;
    }
  } catch { /* fail closed */ }
  return false;
}

// Valid, unexpired grant receipts as extra grants. Same validation as a typed `gogate grant`, same caps; a later typed hard
// or a revoke file closes receipts issued before it.
function clickGrants(key, now, { opencode, hardTs, revokeTs }) {
  const out = [];
  try {
    if (typeof key !== "string" || !CLICK_KEY.test(key)) return out;
    const names = clickNames(`${key}.click-g-`);
    if (!names.length) return out;
    const cred = readClickCredential();
    if (!cred) return out;
    for (const name of names) {
      const rec = loadReceipt(key, name);
      const p = rec?.payload;
      if (!p || p.kind !== "grant" || p.cmd_hash !== "" || !Array.isArray(p.scopes) || !p.scopes.length) continue;
      if (p.issued_at <= revokeTs || p.issued_at <= hardTs || !(p.ms > 0 && p.ms <= MAX_GRANT_MS)) continue;
      const parsed = parseGogateArgs(["grant", p.scopes.join(","), "15m"]);
      if (parsed.error || parsed.scopes.length !== p.scopes.length || !p.scopes.every((s) => parsed.scopes.includes(s))) continue;
      const until = Math.min(p.expires_at, p.issued_at + p.ms);
      if (!(now < until) || !receiptValid(rec, cred, now)) continue;
      for (const scope of parsed.scopes) out.push({ scope, until, session: false });
    }
  } catch { /* fail closed: no click grants */ }
  return out;
}

// Local map clicks: the agenttrail map server writes <go dir>/<key>.local-<id>.json = {via:"map-click", payload} after a plain
// click behind its page token and CSRF/origin guards (owner decision: no WebAuthn). Same payload shape, caps, single use and
// revoke/hard handling as click receipts; the file must be owned by this uid with mode 0600. Every failure means "not covered".
function loadLocalReceipt(key, name) {
  const txt = readOwnedPrivate(join(goDir(), name), CLICK_FILE_MAX);
  if (!txt) return null;
  try {
    const r = JSON.parse(txt);
    const p = r?.payload;
    if (r?.via !== "map-click" || !clickPayloadOk(p) || p.session_key !== key || name !== (p.kind === "grant" ? `${key}.local-g-${p.request_id}.json` : `${key}.local-${p.request_id}.json`)) return null;
    return p;
  } catch { return null; }
}

// A map click never approves release-class scopes (destructive, push to main, publish) and a grant lasts at most 2h.
const LOCAL_NEVER = new Set(["destructive", "push-main", "publish"]);
const LOCAL_GRANT_MAX_MS = 2 * 3600e3;
const LOCAL_REQUEST_MAX_MS = 10 * 60e3;
const localTimeOk = (p, now) => p.issued_at <= now && now < p.expires_at && p.expires_at - p.issued_at <= (p.kind === "go" ? TOKEN_TTL_MS : MAX_GRANT_MS);
const localNever = (p, r) => [...(p.scopes ?? []), ...(r.scopes ?? [])].some((s) => LOCAL_NEVER.has(s));

// A receipt must answer a request the gate recorded: same id (a go receipt also the same command hash), not a hard block,
// recorded no later than the receipt and at most 10 min before it; a go receipt is also refused once the request is 10 min old.
function recordedRequest(key, p, now) {
  try {
    if (!p) return null;
    const txt = readSmallRegular(join(gateDir(), `${key}.req.json`), 64 * 1024);
    if (!txt) return null;
    const a = JSON.parse(txt);
    const r = (Array.isArray(a) ? a : [a]).find((x) => x && x.id === p.request_id && x.hard !== true && (p.kind === "grant" || x.cmd_hash === p.cmd_hash));
    const ts = Date.parse(r?.ts);
    if (!r || !Number.isFinite(ts) || ts > p.issued_at || p.issued_at - ts > LOCAL_REQUEST_MAX_MS || (p.kind === "go" && now - ts > LOCAL_REQUEST_MAX_MS)) return null;
    return r;
  } catch { return null; }
}

// A later typed `hard` in the transcript cancels receipts issued before it.
function lastHardTs(transcriptPath) {
  try {
    const cmds = claudeGogateCommands(transcriptPath);
    const i = cmds.findLastIndex((c) => c.parsed.cmd === "hard");
    return i < 0 ? -Infinity : Number.isFinite(cmds[i].ts) ? cmds[i].ts : Infinity;
  } catch { return Infinity; }
}

export function localClickCovers(command, key, { now = Date.now(), consume = true, hardTs = -Infinity } = {}) {
  try {
    if (typeof command !== "string" || !command.trim() || typeof key !== "string" || !CLICK_KEY.test(key) || !clickEligible(command)) return false;
    if ((inferredReleaseScopes(command) ?? []).some((s) => LOCAL_NEVER.has(s))) return false;
    const want = textHash(command);
    const revokeTs = readRevokeTs(key, now);
    for (const name of clickNames(`${key}.local-`)) {
      if (name.startsWith(`${key}.local-g-`)) continue;
      const p = loadLocalReceipt(key, name);
      const r = p && p.kind === "go" && p.cmd_hash === want ? recordedRequest(key, p, now) : null;
      if (!r || p.issued_at <= revokeTs || p.issued_at <= hardTs || !localTimeOk(p, now) || localNever(p, r) || clickSpent(key, p.request_id)) continue;
      if (!consume) return true;
      if (claimClick(key, p.request_id)) return true;
    }
  } catch { /* fail closed */ }
  return false;
}

function localClickGrants(key, now, { opencode, hardTs, revokeTs }) {
  const out = [];
  try {
    if (typeof key !== "string" || !CLICK_KEY.test(key)) return out;
    for (const name of clickNames(`${key}.local-g-`)) {
      const p = loadLocalReceipt(key, name);
      const r = p && p.kind === "grant" && p.cmd_hash === "" && Array.isArray(p.scopes) && p.scopes.length ? recordedRequest(key, p, now) : null;
      if (!r || p.issued_at <= revokeTs || p.issued_at <= hardTs || !(p.ms > 0 && p.ms <= LOCAL_GRANT_MAX_MS) || !localTimeOk(p, now) || localNever(p, r)) continue;
      const parsed = parseGogateArgs(["grant", p.scopes.join(","), "15m"]);
      if (parsed.error || parsed.scopes.length !== p.scopes.length || !p.scopes.every((s) => parsed.scopes.includes(s))) continue;
      const until = Math.min(p.expires_at, p.issued_at + p.ms);
      if (now < until) for (const scope of parsed.scopes) out.push({ scope, until, session: false });
    }
  } catch { /* fail closed */ }
  return out;
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

// Work profile: a guarded command with no scope (null) is free unless it carries indirection that can hide a release command.
// Built from the classifier's own helpers: shell -c/eval bodies, pipes into a shell, computed or glued heads, braces, release tools through npx.
function indirectReleaseRisk(command) {
  const view = unIFS(commandView(command).text);
  const segs = segments(command);
  if (feedsShell(segs) || opaqueBodyWords(tokens(view)).length || UNSAFE_COMPOUND.test(command)) return true;
  if (/\$\(|\x60/.test(view) || (hasGuardedAssign(segs) && /[$\x60]/.test(command))) return true;
  return scanSplit(view).some((p) => {
    const tk = tokens(p.t.trim());
    if (!tk.length) return false;
    const sp = stripPrefix(tk), h = base(sp.rest[0] ?? "");
    return (sp.opaque && (!SHELLS.test(h) || /^(?:watch|parallel|eval)$/.test(h))) || /^(?:eval|source|\.)$/.test(h) || gluedHead(h) || /^[$\x60]/.test(h) || globHead(unq(sp.rest[0] ?? "")) ||
      tk.some((t) => t.includes("{") && BRACE.test(bareOf(t))) ||
      (/^(?:npx|pnpx|bunx|npm|pnpm|yarn)$/.test(h) && /semantic-release|release-it|changeset|\bnp\b|lerna/.test(p.t));
  });
}

// Gate v2: Content-based keyword scanning and head substitution detection (§2 & §3a).
// Unreadable commands (variables, bash -c, $(...), eval) are judged by content:
// if the text contains a release-class noun, they are Layer B; otherwise Layer C.
// Exception (§3a): A variable or substitution in the head position stays fail-closed.
export function isHeadSubstitution(command) {
  if (typeof command !== "string" || !command.trim()) return false;
  const view = unIFS(commandView(command).text);
  for (const p of scanSplit(view)) {
    const tk = tokens(p.t.trim());
    if (!tk.length) continue;
    const { rest } = stripPrefix(tk);
    if (!rest.length) continue;
    const head = unq(rest[0] ?? "");
    if (/^[$\x60]/.test(head) || /^\$\(/.test(head)) return true;
    if (gluedHead(base(head))) return true;
    if (head === "eval" && rest.slice(1).some((t) => /^[$\x60]/.test(unq(t)))) return true;
    if (/^(?:npm|git|gh|npx|pnpm|yarn|bun)$/.test(head)) {
      const sub = rest.slice(1).find((t) => !unq(t).startsWith("-"));
      if (rest.slice(1).some((t) => /^\$[@*]/.test(unq(t))) || (sub && /^[$\x60]/.test(unq(sub)))) return true;
    }
  }
  return false;
}

export function contentReleaseRisk(command) {
  if (typeof command !== "string") return false;
  if (isHeadSubstitution(command)) return true;
  const view = unIFS(commandView(command).text);

  // 1. Publish / release creation
  if (/\b(?:publish|release\s+create)\b/i.test(view) ||
      /\b(?:semantic-release|release-it)\b/i.test(view) ||
      /\bchangeset\s+publish\b/i.test(view) ||
      /\blerna\s+publish\b/i.test(view)) {
    return true;
  }

  // 2. Protected branch pushes
  if (/\bpush\b[^\n;&|]*\b(?:main|master|release[/_-]|HEAD:(?:refs\/heads\/)?(?:main|master|release[/_-]))\b/i.test(view)) {
    return true;
  }
  if (/\bpush\b[^\n;&|]*(?:--force\b|-f\b)/i.test(view)) {
    return true;
  }

  // 3. Merges into protected branches or PR merges
  if (/\b(?:gh\s+)?pr\s+merge\b/i.test(view) ||
      /\bmerge\b[^\n;&|]*\b(?:main|master)\b/i.test(view)) {
    return true;
  }

  // 4. Destructive git
  if (/\breset\s+--hard\b/i.test(view) ||
      /\bbranch\s+-[a-zA-Z]*D\b/.test(view) ||
      /\bclean\b[^\n;&|]*(?:-[a-zA-Z]*f\b|--force\b)/i.test(view)) {
    return true;
  }

  return false;
}

export function inferredReleaseScopes(command) {
  const scopes = new Set();
  const view = unIFS(commandView(command).text);
  if (/\b(?:publish|release\s+create|semantic-release|release-it)\b/i.test(view)) scopes.add("publish");
  if (/\bpush\b[^\n;&|]*\b(?:main|master|release[/_-]|HEAD:(?:refs\/heads\/)?(?:main|master|release[/_-]))\b/i.test(view)) scopes.add("push-main");
  if (/\b(?:gh\s+)?pr\s+merge\b/i.test(view) || /\bmerge\b[^\n;&|]*\b(?:main|master)\b/i.test(view)) scopes.add("merge");
  if (/\b(?:reset\s+--hard|branch\s+-[a-zA-Z]*D|push\b[^\n;&|]*(?:--force\b|-f\b))\b/i.test(view)) scopes.add("destructive");
  return scopes.size ? [...scopes] : null;
}

export function classifyLayer(command, protectedFor = staticResolver) {
  if (typeof command !== "string") return "B";
  if (hardBlockReason(command) || gateStoreReason(command)) return "A";
  if (commandTooLong(command) || (codexMode && command === CODEX_OPAQUE)) return "B";
  if (isHeadSubstitution(command)) return "B";
  const sc = commandScopes(command, protectedFor);
  if (Array.isArray(sc)) {
    if (sc.some((x) => x === "push-main" || x === "merge" || x === "publish" || x === "destructive")) return "B";
    if (sc.includes("push-feature")) {
      const p = profileFor().profile;
      return p === "strict" ? "B" : "C";
    }
    return "C";
  }
  return contentReleaseRisk(command) ? "B" : "C";
}

// Codex code mode sends JS source (tool `exec`) that calls tools.exec_command({cmd}). Only literal cmd values are read;
// anything else (variable, ${}, concatenation, alias, spread, computed key) marks the source opaque: fail closed.
const JS_ESC = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
function jsString(src, i) {
  const q = src[i];
  let out = "";
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === q) return { value: out, end: j + 1 };
    if (q === "`" && c === "$" && src[j + 1] === "{") return null;
    if (c !== "\\") { out += c; continue; }
    const d = src[++j];
    if (d === "u") {
      const m = /^\{([0-9a-fA-F]{1,6})\}|^([0-9a-fA-F]{4})/.exec(src.slice(j + 1, j + 9));
      if (!m) return null;
      out += String.fromCodePoint(parseInt(m[1] ?? m[2], 16));
      j += m[0].length;
    } else if (d === "x") {
      const h = src.slice(j + 1, j + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(h)) return null;
      out += String.fromCharCode(parseInt(h, 16));
      j += 2;
    } else if (d === "\r" || d === "\n") {
      if (d === "\r" && src[j + 1] === "\n") j++;
    } else if (d !== undefined) out += JS_ESC[d] ?? d;
  }
  return null;
}
function jsSkipWs(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith("//", i)) { const e = src.indexOf("\n", i); i = e < 0 ? src.length : e; }
    else if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; }
    else return i;
  }
}
// Skips one property value; returns the index of the `,` or `}` that ends it, or -1.
function jsSkipValue(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === "`") {
      const s = jsString(src, i);
      if (!s) return -1;
      i = s.end;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) return c === "}" ? i : -1; depth--; }
    else if (c === "," && depth === 0) return i;
    i++;
  }
  return -1;
}
function jsCmdValue(src, i) {
  i = jsSkipWs(src, i);
  let value;
  if (src[i] === "'" || src[i] === '"' || src[i] === "`") {
    const s = jsString(src, i);
    if (!s) return null;
    value = s.value;
    i = s.end;
  } else if (src[i] === "[") {
    const parts = [];
    i = jsSkipWs(src, i + 1);
    while (src[i] !== "]") {
      if (!"'\"`".includes(src[i] ?? "x")) return null;
      const s = jsString(src, i);
      if (!s) return null;
      parts.push(s.value);
      i = jsSkipWs(src, s.end);
      if (src[i] === ",") i = jsSkipWs(src, i + 1);
      else if (src[i] !== "]") return null;
    }
    value = parts.join(" ");
    i++;
  } else return null;
  i = jsSkipWs(src, i);
  return src[i] === "," || src[i] === "}" ? { value, end: i } : null;
}
// Stands in for opaque Codex code in logs and messages; main() lets only a plain GO or a token through for it.
export const CODEX_OPAQUE = 'eval "$AOS_CODEX_EXEC_OPAQUE"';
export function codexExecCommands(src) {
  src = String(src ?? "");
  const cmds = [];
  let opaque = false;
  const all = src.matchAll(/exec_command/g);
  for (const m of all) {
    let i = jsSkipWs(src, m.index + m[0].length);
    if (src[i] !== "(") { opaque = true; continue; }
    i = jsSkipWs(src, i + 1);
    if (src[i] !== "{") { opaque = true; continue; }
    i++;
    let found = false;
    for (;;) {
      i = jsSkipWs(src, i);
      if (src[i] === "}") break;
      let key;
      if (src[i] === "'" || src[i] === '"') {
        const s = jsString(src, i);
        if (!s) { opaque = true; break; }
        key = s.value;
        i = s.end;
      } else {
        const k = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 256));
        if (!k) { opaque = true; break; }
        key = k[0];
        i += key.length;
      }
      i = jsSkipWs(src, i);
      if (src[i] !== ":") {
        if (key === "cmd" || (src[i] !== "," && src[i] !== "}")) { opaque = true; break; }
        if (src[i] === ",") i++;
        continue;
      }
      if (key === "cmd") {
        const v = jsCmdValue(src, i + 1);
        if (!v) { opaque = true; break; }
        cmds.push(v.value);
        found = true;
        i = v.end;
      } else {
        i = jsSkipValue(src, i + 1);
        if (i < 0) { opaque = true; break; }
      }
      if (src[i] === ",") i++;
    }
    if (!found) opaque = true;
  }
  return { cmds, opaque };
}

// Shared by the Claude hook and the OpenCode plugin. Callers run it after hard blocks, the store check, cooldown and the length cap.
// off allows; work allows unless a release scope shows. null scope = guarded but unreadable: free only without indirection.
export function profileAllows(command) {
  if (neverGrantable(command)) return false;
  const p = profileFor().profile;
  if (p === "off") return true;
  if (p !== "work") return false;
  const sc = commandScopes(command);
  return sc ? !sc.some((x) => x === "push-main" || x === "merge" || x === "publish" || x === "destructive") : !(indirectReleaseRisk(command) || contentReleaseRisk(command));
}

function main() {
  hookDeadline = Date.now() + SCAN_MS;
  const rawInput = readStdin();
  // Opt-in payload capture for harness debugging; never on by default, never fatal.
  const dbg = process.env.AOS_GATE_DEBUG;
  if (dbg && isAbsolute(dbg)) {
    try { appendFileSync(dbg, `${maskSecrets(rawInput.replace(/\r?\n/g, " "))}\n`); } catch { /* debug only */ }
  }
  let input = {};
  if (rawInput.trim()) {
    try {
      input = JSON.parse(rawInput);
    } catch (e) {
      // Harness unknown: deny JSON on stdout (Antigravity) plus stderr + exit 2 (Claude Code/Codex) closes every path.
      const reason = `could not parse hook input: ${e.message}`;
      console.log(JSON.stringify({ decision: "deny", reason: `[MECHANICAL GO-GATE BLOCKED] ${reason}` }));
      process.stderr.write(`Blocked by go-gate hook: ${reason}\n`);
      leave(2, "deny", reason);
    }
  }
  if (!input || typeof input !== "object") input = {};
  codexMode = isCodexPayload(input);
  toolNameSeen = String(input.tool_name ?? "");

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
    // Codex's exec_command tool names the shell line `cmd`.
    input?.tool_input?.cmd ||
    input?.command ||
    "";
  // An argv array is joined like aos-acp does; any other non-string value is refused.
  let command = Array.isArray(raw) ? raw.join(" ") : raw;
  // Codex code mode (tool `exec`): JS source whose exec_command calls carry the shell lines.
  let codexOpaque = false;
  if (command === "") {
    const ti = input?.tool_input;
    const code = typeof ti === "string" ? ti : (ti?.code ?? ti?.input ?? ti?.source);
    if (typeof code === "string" && code.includes("exec_command")) {
      const ex = codexExecCommands(code);
      codexOpaque = ex.opaque;
      command = codexOpaque ? CODEX_OPAQUE : ex.cmds.join("\n");
    }
  }
  if (typeof command !== "string") {
    respond(isAgy, false, "command in hook input is not a string; the gate cannot read it (ask for GO)", "");
    return;
  }
  if (!command.trim()) {
    respond(isAgy, true);
    return;
  }

  blockKey = hookBlockKey(input, isAgy);
  // Under work/off a fresh script is judged by its content (scriptInto), not held back by the block cooldown.
  const looser = profileFor().profile !== "strict";
  setGateContext({ cwd: typeof input.cwd === "string" ? input.cwd : "", blockTs: blockKey && !looser ? readBlockTs(blockKey) : 0 });

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

    if (!codexOpaque && !isGuardedCommand(command)) {
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
  if (cooling) {
    const left = Math.max(1, Math.ceil((COOLDOWN_MS - (Date.now() - readBlockTs(blockKey))) / 60000));
    reasons.unshift(`${COOLDOWN_MESSAGE} The block cooldown ends in about ${left} min; after that the same unchanged command may run once (rule 16).`);
  }
  if (tooLong) reasons.unshift(TOO_LONG_MESSAGE);
  if (codexOpaque) reasons.unshift("Codex exec code with a non-literal exec_command; type GO");

  // Gate profile config: any doubt reads as strict. Hard blocks and the store check returned above.
  if (!cooling && !tooLong && !codexOpaque) {
    if (profileAllows(command)) return respond(isAgy, true, "", command);
    if (profileFor().profile === "work") reasons.push("profile work: this command is in the release class and needs a GO");
  }

  // Global grants from config.json (work across all sessions and windows)
  const globalGrants = profileFor().grants || [];
  if (!cooling && !tooLong && !codexOpaque && globalGrants.length > 0 && !neverGrantable(command)) {
    const branchRes = makeBranchResolver(typeof input.cwd === "string" ? input.cwd : process.cwd(), spawnSync);
    const need = commandScopes(command, branchRes);
    if (need && need.length > 0 && need.every((s) => globalGrants.some((g) => g.scope === s || (s === "workspace" && g.scope === "destructive")))) {
      gateLog("global", `global grant: allowed ${JSON.stringify(command.slice(0, 200))}`);
      return respond(isAgy, true, "", command);
    }
  }

  // Modes and grants exist only where go-grant.mjs runs (Claude Code: session_id present).
  const key = !isAgy && input.session_id ? sessionKey(input.session_id) : "";
  if (key && !cooling && !tooLong && !codexOpaque) {
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
  // Last additive path (WP-9): a signed click receipt for exactly this command. Hard blocks and the store check returned above.
  if (key && !tooLong && !cooling && !codexOpaque && (clickReceiptCovers(command, key) || localClickCovers(command, key, { hardTs: lastHardTs(transcriptPath) }))) {
    gateLog(key, `click: allowed ${JSON.stringify(command.slice(0, 200))}`);
    return respond(isAgy, true, "", command);
  }
  respond(isAgy, false, reasons.join("; "), command);
}

// Never fail open: any exception (bad input shape, unreadable state, a bug) denies.
function safeMain() {
  try {
    main();
  } catch (e) {
    const reason = `go-gate internal error, failing closed: ${String(e?.message || e).slice(0, 200)}`;
    if (codexMode) codexDeny(`[MECHANICAL GO-GATE BLOCKED] ${reason}`);
    console.log(JSON.stringify({ decision: "deny", reason: `[MECHANICAL GO-GATE BLOCKED] ${reason}` }));
    process.stderr.write(`Blocked by go-gate hook: ${reason}\n`);
    leave(2, "deny", reason);
  }
}

// Run as a hook (node go-gate.mjs); importing it (bin/aos-acp.mjs) must not.
const invokedAs = (() => { try { return realpathSync(process.argv[1] || ""); } catch { return ""; } })();
if (invokedAs === fileURLToPath(import.meta.url)) safeMain();
