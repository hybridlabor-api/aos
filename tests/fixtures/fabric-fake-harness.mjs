// One script behind the fake claude/codex/opencode/agy/npx/ao binaries of the cross-harness smoke test.
// usage (through a shim): node fabric-fake-harness.mjs <name> [args...]
// It reads the brief it was given, writes the report the brief asks for and ends. No model, no login, no network.
import fs from 'node:fs';
import readline from 'node:readline';
import { answerBrief } from './fabric-helpers.mjs';

const [name, ...args] = process.argv.slice(2);

const answer = (briefText) => answerBrief(briefText, process.cwd());
const briefIn = (pointer) => fs.readFileSync(/brief file (.+?) exactly as written/.exec(pointer)[1], 'utf8');

if (name === 'agy') {
  // aos-acp agy: agy ... --print <brief text>
  answer(args[args.indexOf('--print') + 1]);
  process.stdout.write(`${JSON.stringify({ status: 'SUCCESS', response: 'done', conversation_id: 'fake' })}\n`);
} else if (name === 'codex') {
  // codex exec --sandbox <mode> -- <pointer prompt>
  answer(briefIn(args.at(-1)));
} else if (name === 'ao') {
  // ao --version | ao spawn --help | ao spawn --workdir <dir> ... --prompt <pointer prompt> --json; AOS_FAKE_AO_OLD=1 is an ao without --workdir
  if (args[0] === '--version') process.stdout.write('ao 0.0.0-fake\n');
  else if (args.includes('--help')) process.stdout.write(`usage: ao spawn --project <id> --agent <h> --name <n> --prompt <t>${process.env.AOS_FAKE_AO_OLD ? '' : ' --workdir <path>'}\n`);
  else {
    answer(briefIn(args[args.indexOf('--prompt') + 1]));
    process.stdout.write(`${JSON.stringify({ id: 'x1', status: 'running', displayName: 'x', workdir: args[args.indexOf('--workdir') + 1], claimedPr: null })}\n`);
  }
} else {
  // opencode acp / npx <acp adapter>: a minimal Agent Client Protocol agent over stdio
  const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.method === 'initialize') send(msg.id, { protocolVersion: 1, agentInfo: { name: `fake-${name}` }, authMethods: [] });
    else if (msg.method === 'session/new') send(msg.id, { sessionId: 's1' });
    else if (msg.method === 'session/set_config_option') send(msg.id, {});
    else if (msg.method === 'session/prompt') { answer(msg.params.prompt[0].text); send(msg.id, { stopReason: 'end_turn' }); }
    else if (msg.method === 'session/cancel') process.exit(0);
  });
}
