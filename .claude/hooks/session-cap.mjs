// aos-hook-version: 1
// Per-context-profile SessionStart cap (lib/v5/context-profiles.js maxSessionStartChars). Fails open to 2000.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CAP = 2000;

export function sessionStartCap(home = os.homedir()) {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const inCheckout = (() => { try { return JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8')).name === '@hybridlabor-api/aos'; } catch { return false; } })();
    const settings = JSON.parse(readFileSync(path.join(home, '.aos', 'v5-settings.json'), 'utf8'));
    const req = createRequire(import.meta.url);
    const lib = inCheckout ? path.join(here, '..', '..', 'lib', 'v5', 'context-profiles.js') : path.join(home, '.agents', 'lib', 'context-profiles.js');
    const { CONTEXT_PROFILE_DEFS, contextProfileOf } = req(lib);
    const cap = CONTEXT_PROFILE_DEFS[contextProfileOf(settings)].maxSessionStartChars;
    return Number.isInteger(cap) && cap > 0 ? cap : DEFAULT_CAP;
  } catch { return DEFAULT_CAP; }
}

export const capText = (text, home) => { const n = sessionStartCap(home); return text.length > n ? text.slice(0, n) : text; };
