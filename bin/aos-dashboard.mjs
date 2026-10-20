#!/usr/bin/env node
'use strict';
// AOS Dashboard is now a thin alias: it starts the AOS Hub on the same port
// (7900) and opens it on the services tab. All serving, guarding and
// control are in bin/aos-hub.mjs — nothing is duplicated here.
//
//   aos-dashboard [--port 7900] [--no-open]

import { cli } from './aos-hub.mjs';

const raw = process.argv.slice(2);
const args = ['--tab', 'services'];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--port') { args.push('--port', raw[++i]); }
  else if (a === '--no-open') { args.push('--no-open'); }
  else {
    console.error(`aos-dashboard: unknown argument ${a} (supported: --port N, --no-open)`);
    process.exit(2);
  }
}
if (process.env.AOS_NO_OPEN === '1' && !args.includes('--no-open')) {
  args.push('--no-open');
}

cli(args).then((code) => process.exit(code ?? 0)).catch((e) => {
  console.error(`aos-dashboard: ${e.message}`);
  process.exit(2);
});
