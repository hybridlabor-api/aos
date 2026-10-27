// Import this FIRST in a CLI entry (`import '../lib/cli-help-guard.mjs';`). ESM evaluates imports in order,
// so `--help`, `-h` and `help` are answered before any other module or top-level code of the CLI runs.
// It only acts when the process entry script is a CLI that has a spec; a library import is a no-op.
import { realpathSync } from 'node:fs';
import { findSpecByEntry, helpFor, wantsHelp } from './cli-help.mjs';

const argv = process.argv.slice(2);
if (wantsHelp(argv)) {
  let spec = null;
  try { spec = findSpecByEntry(realpathSync(process.argv[1])); } catch { /* not a CLI entry */ }
  if (spec) process.stdout.write(`${helpFor(spec, argv)}\n`, () => process.exit(0));
  // Park until the write callback exits, so no later import runs a side effect.
  if (spec) await new Promise(() => {});
}
