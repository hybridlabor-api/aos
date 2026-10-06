#!/usr/bin/env node
// aos-a2a — A2A peer-mesh CLI (phase 1a: registry listing and Agent Card generation).
import { parseArgs } from "node:util";
import { list } from "../lib/a2a-registry.mjs";
import { cardFromProfile, loadProfile } from "../lib/a2a-card.mjs";

const USAGE = `usage:
  aos-a2a list [--json] [--prune]
  aos-a2a card --profile <file> --name <n> --harness <h> [--model <m>] [--url <u>]`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" }, json: { type: "boolean" }, prune: { type: "boolean" },
    profile: { type: "string" }, name: { type: "string" }, harness: { type: "string" }, model: { type: "string" }, url: { type: "string" },
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
  } else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (e) {
  console.error(`aos-a2a: ${e.message}`);
  process.exit(2);
}
