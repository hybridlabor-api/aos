#!/usr/bin/env node
// AOS SessionStart hint hook: injects a 3-line "daily tools" hint as
// additional context. Zero dependencies, never throws, always exit 0.
//   Input:  the harness SessionStart JSON on stdin (content is not used).
//   Output: {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
//   Off switches: AOS_SESSION_HINT=off (human or installer kills it) and
//   AOS_DELEGATE_DEPTH>0 (delegated workers stay silent).
import { readFileSync, existsSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const hintOff = () => process.env.AOS_SESSION_HINT === "off" || process.env.AOS_SESSION_START_CONTEXT === "off" || Number(process.env.AOS_DELEGATE_DEPTH || 0) > 0;

// Retrieval tools that are installed here, probed with fs only (no spawn). [] when none.
export function memoryTools({ home = homedir(), env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const dirs = String(env.PATH || '').split(platform === 'win32' ? ';' : ':').concat(['/usr/local/bin', '/opt/homebrew/bin', join(home, '.local', 'bin')]);
  const exts = platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  const onPath = (name) => dirs.some((d) => d && exts.some((e) => exists(join(d, name + e))));
  let off = [];
  try { off = JSON.parse(readFileSync(join(home, '.aos', 'v5-settings.json'), 'utf8')).disabled || []; } catch {}
  const on = (id) => !off.includes(id);
  return [
    ['memb search', on('memb') && (exists(join(home, '.MemBDB', 'memb.db')) || exists(join(home, '.agents', 'memB')))],
    ['deja search', on('deja') && onPath('deja')],
    ['openwiki_search', on('openwiki') && onPath('openwiki')],
    ['codebase_memory_mcp', onPath('codebase-memory-mcp')],
  ].filter(([, ok]) => ok).map(([n]) => n);
}

// The hint text, shared with the OpenCode plugin. "" when switched off.
export async function buildHint() {
  if (hintOff()) return "";
  const hints = [
    'plan-canvas is available for plan review — check the canvas with `aos-plan-canvas` and open a plan with `aos-plan-canvas open <file|plan-dir>`.',
    'agenttrail serves a live map of multi-agent builds when one is running.',
    'The automatic tool-routing rules (when to use plan-canvas, agenttrail, subagents, startcycle) live in the "Tool routing (automatic)" block of AGENTS.md.',
  ];
  try {
    const tools = memoryTools();
    if (tools.length) hints.push(`Need more context? Pull it on demand: ${tools.join(', ')}.`);
  } catch {}
  try {
    const home = homedir();
    let notice = null;
    try {
      const { cachedUpdateNotice } = await import("../../lib/update-check.js");
      notice = cachedUpdateNotice({ home });
    } catch {
      const fallbackLib = join(home, ".agents", "lib", "update-check.js");
      if (existsSync(fallbackLib)) {
        const { cachedUpdateNotice } = await import(fallbackLib);
        notice = cachedUpdateNotice({ home });
      }
    }
    if (notice) {
      hints.push(notice);
      // stderr reaches the user's terminal without breaking the hook runner's JSON on stdout.
      process.stderr.write(`${notice}\n`);
    }
  } catch {}
  // Post-update line: once per update, from the marker `aos update` leaves (lib/whats-new.js)
  try {
    const marker = join(homedir(), ".aos", "cache", "last-update.json");
    const m = JSON.parse(readFileSync(marker, "utf8"));
    if (m && !m.shown && m.version && Date.now() - m.t < 7 * 86400000) {
      const line = `AOS updated to ${m.version} — run \`aos setup\` to optimize (${Number(m.hints) || 0} hints)`;
      hints.unshift(line);
      process.stderr.write(`${line}\n`);
      writeFileSync(marker, JSON.stringify({ ...m, shown: true }));
    }
  } catch {}
  const { capText } = await import("./session-cap.mjs");
  return capText(hints.join("\n"), homedir());
}

// agy has no SessionStart event: the PreInvocation hook runs every turn, so a stamp per conversation keeps it to the first one.
export function agyHintFirstTime(conversationId, base = join(homedir(), ".aos", "cache", "hint-agy")) {
  const id = String(conversationId || "").replace(/[^\w.-]/g, "_").slice(0, 80);
  if (!id) return false;
  const stamp = join(base, id);
  if (existsSync(stamp)) return false;
  try { mkdirSync(base, { recursive: true }); writeFileSync(stamp, ""); } catch {}
  return true;
}

async function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch {} // unparseable input is still not an error
  const isAgy = !input.hook_event_name && (Array.isArray(input.workspacePaths) || !!input.conversationId);
  if (isAgy && !agyHintFirstTime(input.conversationId)) return;
  const hint = await buildHint();
  if (!hint) return;
  process.stdout.write(JSON.stringify(isAgy
    ? { injectSteps: [{ ephemeralMessage: hint }] }
    : { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: hint } }) + "\n");
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  try { await main(); } catch {}
  process.exit(0);
}
