#!/usr/bin/env node
// aos-a2a — A2A peer-mesh CLI (phase 1a: registry listing and Agent Card generation).
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { list, book } from "../lib/a2a-registry.mjs";
import { cardFromProfile, loadProfile } from "../lib/a2a-card.mjs";

const USAGE = `usage:
  aos-a2a list [--json] [--prune]
  aos-a2a book
  aos-a2a label [--name <name>] <text>
  aos-a2a card --profile <file> --name <n> --harness <h> [--model <m>] [--url <u>]
  aos-a2a serve --name <n> --harness <h> [--profile <file>] [--mode echo|live|agy|codex|spawn] [--parent-pid <pid>]
                [--label <text>] [--write] [--repo <path>] [--thread <codex thread name or uuid>] [--codex-transport queue|resume]
  aos-a2a send (--to <name|label> | --role <role>) [--from <name>] [--timeout <s>] [--background]
               [--task <taskId> --go-ref <ref>] "<text>"
  aos-a2a status --to <name> <taskId>
  aos-a2a cancel --to <name> <taskId>
  aos-a2a watch <name> [--once]
  aos-a2a reply [--name <name>] <taskId> "<text>"`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" }, json: { type: "boolean" }, prune: { type: "boolean" },
    profile: { type: "string" }, name: { type: "string" }, harness: { type: "string" }, model: { type: "string" }, url: { type: "string" },
    mode: { type: "string" }, "parent-pid": { type: "string" }, write: { type: "boolean" }, repo: { type: "string" },
    thread: { type: "string" }, "codex-transport": { type: "string" },
    to: { type: "string" }, role: { type: "string" }, from: { type: "string" },
    task: { type: "string" }, "go-ref": { type: "string" },
    timeout: { type: "string" },     background: { type: "boolean" },
    once: { type: "boolean" },
    label: { type: "string" },
  },
});

// Windows/Node 24: process.exit() while fetch/undici handles are closing aborts with a libuv
// UV_HANDLE_CLOSING assertion (exit 9). Let the loop drain there; the unref'd timer is a backstop.
function exitAfterDrain(code) {
  if (process.platform !== "win32") process.exit(code);
  process.exitCode = code;
  setTimeout(() => process.exit(code), 3000).unref();
}

function formatAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return "-";
  if (ms < 0) ms = 0;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

if (o.help || !positionals.length) { console.log(USAGE); process.exit(o.help ? 0 : 2); }

try {
  const [cmd] = positionals;
  if (cmd === "list") {
    const prune = o.prune !== false;
    const sessions = list({ prune, includeStale: !prune });
    if (o.json) console.log(JSON.stringify(sessions, null, 2));
    else {
      for (const s of sessions) {
        const label = s.label ? `${s.label} (${s.name})` : s.name;
        const status = s.stale ? "stale" : (s.status ?? "idle");
        const ts = typeof s.ts === "number" ? s.ts : Date.parse(s.ts ?? "");
        const age = formatAge(Date.now() - (Number.isFinite(ts) ? ts : Date.now()));
        console.log(`${label}\t${s.harness}\t${s.cwd ?? ""}\t${status}\t${age}`);
      }
    }
  } else if (cmd === "book") {
    console.log(JSON.stringify(book(), null, 2));
    process.exit(0);
  } else if (cmd === "label") {
    if (positionals.length < 2) throw new Error("usage: aos-a2a label [--name <name>] <text>");
    const name = o.name || process.env.AOS_A2A_NAME;
    if (!name) throw new Error("label needs --name <name> or env AOS_A2A_NAME");
    const { setLabel } = await import("../lib/a2a-registry.mjs");
    const text = positionals.slice(1).join(" ");
    const updated = setLabel(name, text);
    console.log(JSON.stringify({ name: updated.name, label: updated.label }));
  } else if (cmd === "card") {
    if (!o.name || !o.harness) throw new Error("card needs --name and --harness");
    console.log(JSON.stringify(cardFromProfile(loadProfile({ profile: o.profile }), { name: o.name, harness: o.harness, model: o.model, url: o.url }), null, 2));
  } else if (cmd === "serve") {
    if (o.label) process.env.AOS_A2A_LABEL = o.label;
    if (!o.name || !o.harness) throw new Error("serve needs --name and --harness");
    const modes = ["echo", "live", "agy", "codex", "spawn"];
    if (o.mode && !modes.includes(o.mode)) throw new Error(`unknown --mode ${o.mode} (echo, live, agy, codex or spawn)`);
    if (o["codex-transport"] && o["codex-transport"] !== "queue" && o["codex-transport"] !== "resume") {
      throw new Error(`invalid --codex-transport ${o["codex-transport"]} (queue or resume)`);
    }
    const { startSidecar, echoExecutor } = await import("../lib/a2a-sidecar.mjs");
    const { loadProfile, defaultProfile } = await import("../lib/a2a-card.mjs");
    const parentPid = o["parent-pid"] ? Number(o["parent-pid"]) : undefined;
    // an explicit --profile must load; otherwise fall back to the built-in live profile (hooks start serve without one)
    let profile;
    try { profile = loadProfile({ profile: o.profile }); } catch (e) {
      if (o.profile || !/^no profile found/.test(e.message)) throw e;
      profile = defaultProfile(o.harness);
    }
    let executor;
    if (o.mode === "agy") {
      executor = (await import("../lib/a2a-agy.mjs")).agyResumeExecutor({ session: o.name });
    } else if (o.mode === "codex") {
      if (!o.thread) throw new Error("--mode codex needs --thread <name or uuid of an already open Codex session>");
      executor = (await import("../lib/a2a-codex.mjs")).codexLiveExecutor({
        session: o.name, thread: o.thread, mode: o["codex-transport"] ?? "queue",
      });
    } else if (o.mode === "spawn") {
      const repo = o.repo || fileURLToPath(new URL("..", import.meta.url));
      executor = (await import("../lib/a2a-spawn.mjs")).spawnExecutor({
        session: o.name, harness: o.harness, write: !!o.write, repo,
      });
    } else if (o.mode === "live") {
      executor = (await import("../lib/a2a-live.mjs")).liveExecutor({ session: o.name });
    } else {
      executor = echoExecutor({ name: o.name, harness: o.harness });
    }
    const s = await startSidecar({ name: o.name, harness: o.harness, profile, parentPid, asCli: true, executor });
    console.log(JSON.stringify({ name: o.name, url: s.url, cardUrl: s.cardUrl, pid: process.pid }));
  } else if (cmd === "send") {
    if ((!o.to && !o.role) || positionals.length < 2) throw new Error('usage: aos-a2a send (--to <name|label> | --role <role>) [--from <name>] [--timeout <s>] [--background] [--task <taskId> --go-ref <ref>] "<text>"');
    const { send } = await import("../lib/a2a-client.mjs");
    const result = await send({
      to: o.to, role: o.role, from: o.from, text: positionals.slice(1).join(" "),
      // GO-over-A2A follow-up: --task <taskId> --go-ref <ref> repeats the same task id with the
      // human-forwarded reference in metadata.aos.goRef. The reference is a pointer, not a GO;
      // the receiver verifies it read-only and the session's own gate decides.
      taskId: o.task, goRef: o["go-ref"],
      timeoutMs: o.timeout ? Number(o.timeout) * 1000 : undefined, background: !!o.background,
    });
    console.log(JSON.stringify(result, null, 2));
    exitAfterDrain(result.state === "TASK_STATE_COMPLETED" || o.background ? 0 : 1);
  } else if (cmd === "status") {
    if (!o.to || positionals.length < 2) throw new Error("usage: aos-a2a status --to <name> <taskId>");
    const { status } = await import("../lib/a2a-client.mjs");
    console.log(JSON.stringify(await status({ to: o.to, taskId: positionals[1] }), null, 2));
  } else if (cmd === "cancel") {
    if (!o.to || positionals.length < 2) throw new Error("usage: aos-a2a cancel --to <name> <taskId>");
    const { cancel } = await import("../lib/a2a-client.mjs");
    console.log(JSON.stringify(await cancel({ to: o.to, taskId: positionals[1] }), null, 2));
  } else if (cmd === "watch") {
    if (positionals.length < 2) throw new Error("usage: aos-a2a watch <name> [--once]");
    const { watch } = await import("../lib/a2a-watch.mjs");
    process.exitCode = await watch({ name: positionals[1], once: !!o.once });
  } else if (cmd === "reply") {
    if (positionals.length < 3) throw new Error('usage: aos-a2a reply [--name <name>] <taskId> "<text>"');
    const { reply } = await import("../lib/a2a-client.mjs");
    const out = reply({ name: o.name, taskId: positionals[1], text: positionals.slice(2).join(" ") });
    console.log(JSON.stringify(out));
  } else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (e) {
  console.error(`aos-a2a: ${e.message}`);
  process.exit(2);
}
