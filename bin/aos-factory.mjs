#!/usr/bin/env node
import { resolveFactorySandbox } from "../lib/sandbox.mjs";

export function main(argv = process.argv.slice(2)) {
  const unattended = argv.includes("--unattended");
  if (unattended) {
    const sbx = resolveFactorySandbox();
    if (!sbx.ok) {
      console.error(`factory: unattended mode refused: ${sbx.message}`);
      process.exitCode = 1;
      return 1;
    }
    const cmd = argv.filter((a) => a !== "--unattended");
    const wrapped = sbx.wrap(cmd.length ? cmd : ["factory"]);
    console.log(`Starting unattended factory run in ${sbx.runtime} sandbox: ${wrapped.join(" ")}`);
    return 0;
  }
  console.log("factory: running in interactive host session (normal GO gate rules apply)");
  return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main();
}
