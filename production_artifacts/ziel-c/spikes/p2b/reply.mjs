#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [taskId, ...rest] = process.argv.slice(2);
if (!taskId || !rest.length) { console.error('usage: reply.mjs <taskId> "<text>"'); process.exit(2); }
const name = process.env.AOS_A2A_NAME;
const inboxRoot = process.env.AOS_A2A_INBOX;
if (!name || !inboxRoot) { console.error('AOS_A2A_NAME and AOS_A2A_INBOX required'); process.exit(2); }
const text = rest.join(' ');
if (Buffer.byteLength(text, 'utf8') > 8192) { console.error('reply too large (max 8 KiB)'); process.exit(2); }
const dir = path.join(inboxRoot, name);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const f = path.join(dir, `${taskId}.reply`);
fs.writeFileSync(f, text, { mode: 0o600 });
fs.chmodSync(f, 0o600);
