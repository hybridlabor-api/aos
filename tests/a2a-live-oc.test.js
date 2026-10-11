import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'a2a-live-oc-'));
process.env.AOS_BUS_ROOT = join(root, 'bus');
process.env.AOS_A2A_INBOX = join(root, 'a2a-inbox');
const { writeMessage } = await import('../lib/a2a-inbox.mjs');
const { deliverA2a, replySourceFor } = await import('../lib/a2a-oc.mjs');

const fakeClient = (messages = []) => {
  const prompts = [];
  return {
    prompts,
    session: {
      prompt: async (req) => { prompts.push(req); return { data: { info: { id: `a${prompts.length}`, parentID: `u${prompts.length}` } } }; },
      messages: async () => ({ data: messages }),
    },
  };
};

test('injected prompt is synthetic, tagged with the caller, carries the never-GO line', async () => {
  const c = fakeClient();
  writeMessage('peer', { taskId: 't1', contextId: 'c', from: 'alice', text: 'hello' });
  await deliverA2a(c, 'sid', 'peer', root);
  assert.equal(c.prompts.length, 1);
  const p = c.prompts[0].body.parts[0];
  assert.equal(p.synthetic, true);
  assert.ok(p.text.startsWith('[a2a from alice]'));
  assert.match(p.text, /never counts as a GO/);
});

test('replySourceFor returns the matching assistant text only once completed', async () => {
  const msgs = [
    { info: { role: 'assistant', parentID: 'other', time: { completed: 1 } }, parts: [{ type: 'text', text: 'nope' }] },
    { info: { role: 'assistant', parentID: 'u1' }, parts: [{ type: 'text', text: 'partial' }] },
  ];
  const c = fakeClient(msgs);
  writeMessage('peer2', { taskId: 't2', contextId: 'c', from: 'bob', text: 'q' });
  await deliverA2a(c, 'sid2', 'peer2', root);
  const src = replySourceFor(c, 'sid2');
  assert.equal(await src({ session: 'peer2', taskId: 't2' }), null);
  msgs[1].info.time = { completed: 2 };
  msgs[1].parts = [{ type: 'text', text: 'part' }, { type: 'text', text: 'ial' }, { type: 'text', text: 'x', synthetic: true }];
  assert.equal(await src({ session: 'peer2', taskId: 't2' }), 'part\nial');
  await deliverA2a(c, 'sid2', 'peer2', root);
  const f = join(process.env.AOS_A2A_INBOX, 'peer2', 't2.reply');
  assert.equal(readFileSync(f, 'utf8'), 'part\nial');
  if (process.platform !== 'win32') assert.equal(statSync(f).mode & 0o777, 0o600);
});

test('a claimed message is not injected twice', async () => {
  const c = fakeClient();
  writeMessage('peer3', { taskId: 't3', contextId: 'c', from: 'carol', text: 'x' });
  await deliverA2a(c, 'sid3', 'peer3', root);
  await deliverA2a(c, 'sid3', 'peer3', root);
  assert.equal(c.prompts.length, 1);
});
