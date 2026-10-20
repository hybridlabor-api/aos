#!/usr/bin/env node
// aos-go-ref: read-only check of a GO-over-A2A reference for humans and scripts.
//
//   aos-go-ref verify --session <Name> --ref <id>
//
// Prints JSON {"ok":bool,"reason":"..."}; exit 0 ok, 1 denied (forged, wrong-target,
// expired, replayed, malformed), 2 usage error. HONOURS THE TEST SEAM: HOME points the
// token store at a temp directory. There is no subcommand that issues, writes or
// consumes anything — the consume happens on the gate side when a session resumes a task.
import "../lib/cli-help-guard.mjs";
import { verifyGoRef } from "../lib/a2a-go.mjs";

const usage = () => {
  process.stdout.write(JSON.stringify({ ok: false, reason: "usage: aos-go-ref verify --session <name> --ref <id>" }) + "\n");
  process.exit(2);
};

const [sub, ...rest] = process.argv.slice(2);
if (sub !== "verify") usage();
const o = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--session") o.session = rest[++i];
  else if (rest[i] === "--ref") o.ref = rest[++i];
  else usage();
}
if (!o.session || !o.ref) usage();
const r = await verifyGoRef({ session: o.session, ref: o.ref });
process.stdout.write(JSON.stringify({ ok: r.ok, reason: r.reason }) + "\n");
process.exit(r.ok ? 0 : 1);
