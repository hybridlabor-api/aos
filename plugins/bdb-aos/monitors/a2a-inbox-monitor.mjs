#!/usr/bin/env node
// bdb-aos plugin monitor: one stdout line per A2A message for this session, which wakes an idle Claude Code
// session. The logic lives in lib/a2a-monitor.mjs: the repo checkout when the plugin is loaded in place
// (plugins/bdb-aos/monitors -> ../../../lib), else the machine-wide copy the AOS installer keeps in ~/.agents/lib.
// stdout carries notifications only; every diagnostic goes to stderr.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const lib = [
  fileURLToPath(new URL("../../../lib/a2a-monitor.mjs", import.meta.url)),
  join(homedir(), ".agents", "lib", "a2a-monitor.mjs"),
].find((p) => existsSync(p));

if (!lib) {
  process.stderr.write("a2a-inbox monitor: lib/a2a-monitor.mjs not found (run the AOS installer); monitor idle.\n");
  process.exit(0);
}

try {
  const { runMonitor } = await import(pathToFileURL(lib).href);
  runMonitor();
} catch (e) {
  process.stderr.write(`a2a-inbox monitor: ${e?.message || e}\n`);
  process.exit(0);
}
