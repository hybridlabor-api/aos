#!/usr/bin/env node
// aos-a2a — A2A peer-mesh CLI (phase 1a: registry listing and Agent Card generation).
import { parseArgs } from "node:util";
import { list, book } from "../lib/a2a-registry.mjs";
import { cardFromProfile, loadProfile } from "../lib/a2a-card.mjs";

const USAGE = `usage:
  aos-a2a list [--json] [--prune]
  aos-a2a book
  aos-a2a card --profile <file> --name <n> --harness <h> [--model <m>] [--url <u>]
  aos-a2a serve --name <n> --harness <h> [--profile <file>] [--mode echo|live] [--parent-pid <pid>]
  aos-a2a send (--to <name> | --role <role>) [--from <name>] [--timeout <s>] [--background] "<text>"
  aos-a2a status --to <name> <taskId>
  aos-a2a cancel --to <name> <taskId>
  aos-a2a reply [--name <name>] <taskId> "<text>"`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" }, json: { type: "boolean" }, prune: { type: "boolean" },
    profile: { type: "string" }, name: { type: "string" }, harness: { type: "string" }, model: { type: "string" }, url: { type: "string" },
    mode: { type: "string" }, "parent-pid": { type: "string" },
    to: { type: "string" }, role: { type: "string" }, from: { type: "string" },
    timeout: { type: "string" }, background: { type: "boolean" },
  },
});

if (o.help || !positionals.length) { console.log(USAGE); process.exit(o.help ? 0 : 2); }

try {
  const [cmd] = positionals;
  if (cmd === "list") {
    const sessions = list({ prune: o.prune });
    if (o.json) console.log(JSON.stringify(sessions, null, 2));
    else for (const s of sessions) console.log(`${s.name}\t${s.harness}\tpid ${s.pid}\t${s.url ?? "-"}\t${s.cwd ?? ""}`);
  } else if (cmd === "book") {
    console.log(JSON.stringify(book(), null, 2));
    process.exit(0);
  } else if (cmd === "card") {
    if (!o.name || !o.harness) throw new Error("card needs --name and --harness");
    console.log(JSON.stringify(cardFromProfile(loadProfile({ profile: o.profile }), { name: o.name, harness: o.harness, model: o.model, url: o.url }), null, 2));
  } else if (cmd === "serve") {
    if (!o.name || !o.harness) throw new Error("serve needs --name and --harness");
    if (o.mode && o.mode !== "echo" && o.mode !== "live") throw new Error(`unknown --mode ${o.mode} (echo or live)`);
    const { startSidecar, echoExecutor } = await import("../lib/a2a-sidecar.mjs");
    const { loadProfile, defaultProfile } = await import("../lib/a2a-card.mjs");
    const parentPid = o["parent-pid"] ? Number(o["parent-pid"]) : undefined;
    // an explicit --profile must load; otherwise fall back to the built-in live profile (hooks start serve without one)
    let profile;
    try { profile = loadProfile({ profile: o.profile }); } catch (e) {
      if (o.profile || !/^no profile found/.test(e.message)) throw e;
      profile = defaultProfile(o.harness);
    }
    const executor = o.mode === "live"
      ? (await import("../lib/a2a-live.mjs")).liveExecutor({ session: o.name })
      : echoExecutor({ name: o.name, harness: o.harness });
    const s = await startSidecar({ name: o.name, harness: o.harness, profile, parentPid, asCli: true, executor });
    console.log(JSON.stringify({ name: o.name, url: s.url, cardUrl: s.cardUrl, pid: process.pid }));
  } else if (cmd === "send") {
    if ((!o.to && !o.role) || positionals.length < 2) throw new Error('usage: aos-a2a send (--to <name> | --role <role>) [--from <name>] [--timeout <s>] [--background] "<text>"');
    const { send } = await import("../lib/a2a-client.mjs");
    const result = await send({
      to: o.to, role: o.role, from: o.from, text: positionals.slice(1).join(" "),
      timeoutMs: o.timeout ? Number(o.timeout) * 1000 : undefined, background: !!o.background,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.state === "TASK_STATE_COMPLETED" || o.background ? 0 : 1);
  } else if (cmd === "status") {
    if (!o.to || positionals.length < 2) throw new Error("usage: aos-a2a status --to <name> <taskId>");
    const { status } = await import("../lib/a2a-client.mjs");
    console.log(JSON.stringify(await status({ to: o.to, taskId: positionals[1] }), null, 2));
  } else if (cmd === "cancel") {
    if (!o.to || positionals.length < 2) throw new Error("usage: aos-a2a cancel --to <name> <taskId>");
    const { cancel } = await import("../lib/a2a-client.mjs");
    console.log(JSON.stringify(await cancel({ to: o.to, taskId: positionals[1] }), null, 2));
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
