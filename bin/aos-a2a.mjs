#!/usr/bin/env node
// aos-a2a — A2A peer-mesh CLI (phase 1a: registry listing and Agent Card generation).
import { parseArgs } from "node:util";
import { list } from "../lib/a2a-registry.mjs";
import { cardFromProfile, loadProfile } from "../lib/a2a-card.mjs";

const USAGE = `usage:
  aos-a2a list [--json] [--prune]
  aos-a2a card --profile <file> --name <n> --harness <h> [--model <m>] [--url <u>]
  aos-a2a serve --name <n> --harness <h> [--profile <file>] [--mode echo] [--parent-pid <pid>]`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" }, json: { type: "boolean" }, prune: { type: "boolean" },
    profile: { type: "string" }, name: { type: "string" }, harness: { type: "string" }, model: { type: "string" }, url: { type: "string" },
    mode: { type: "string" }, "parent-pid": { type: "string" },
  },
});

if (o.help || !positionals.length) { console.log(USAGE); process.exit(o.help ? 0 : 2); }

try {
  const [cmd] = positionals;
  if (cmd === "list") {
    const sessions = list({ prune: o.prune });
    if (o.json) console.log(JSON.stringify(sessions, null, 2));
    else for (const s of sessions) console.log(`${s.name}\t${s.harness}\tpid ${s.pid}\t${s.url ?? "-"}\t${s.cwd ?? ""}`);
  } else if (cmd === "card") {
    if (!o.name || !o.harness) throw new Error("card needs --name and --harness");
    console.log(JSON.stringify(cardFromProfile(loadProfile({ profile: o.profile }), { name: o.name, harness: o.harness, model: o.model, url: o.url }), null, 2));
  } else if (cmd === "serve") {
    if (!o.name || !o.harness) throw new Error("serve needs --name and --harness");
    if (o.mode && o.mode !== "echo") throw new Error(`unknown --mode ${o.mode} (only echo)`);
    const { startSidecar, echoExecutor } = await import("../lib/a2a-sidecar.mjs");
    const { loadProfile } = await import("../lib/a2a-card.mjs");
    const parentPid = o["parent-pid"] ? Number(o["parent-pid"]) : undefined;
    const profile = loadProfile({ profile: o.profile });
    const s = await startSidecar({
      name: o.name, harness: o.harness, profile, parentPid, asCli: true,
      executor: echoExecutor({ name: o.name, harness: o.harness }),
    });
    console.log(JSON.stringify({ name: o.name, url: s.url, cardUrl: s.cardUrl, pid: process.pid }));
  } else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (e) {
  console.error(`aos-a2a: ${e.message}`);
  process.exit(2);
}
