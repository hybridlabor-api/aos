// OpenCode live peer helpers. Kept out of the plugin module: OpenCode calls every export of a plugin file.
// The plugin injects the message, then writes <replyDir>/<taskId>.reply (0600) once the assistant turn
// completed, so liveExecutor's default file replySource works unchanged.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { claim as a2aClaim, formatInjection, pending as a2aPending, replyDir } from './a2a-inbox.mjs';

const a2aInjected = new Map(); // taskId -> { id: injected user message id, name: bus name }

export function replySourceFor(client, sessionID) {
  return async ({ taskId }) => {
    const rec = a2aInjected.get(taskId);
    if (!rec) return null;
    try {
      const res = await client.session.messages({ path: { id: sessionID } });
      const m = (res?.data || []).find((x) => x.info?.role === 'assistant' && x.info.parentID === rec.id);
      if (!m?.info?.time?.completed) return null;
      return (m.parts || []).filter((p) => p.type === 'text' && !p.synthetic && !p.ignored).map((p) => p.text).join('\n');
    } catch { return null; }
  };
}

export async function deliverA2a(client, sessionID, name, directory) {
  if (typeof sessionID !== 'string' || typeof name !== 'string') return;
  for (const m of a2aPending(name)) {
    const msg = a2aClaim(m.file);
    if (!msg) continue;
    const text = formatInjection(msg);
    const metadata = { aos_a2a: { from: msg.from, taskId: msg.taskId } };
    try {
      const res = await client.session.prompt({
        path: { id: sessionID },
        query: directory ? { directory } : undefined,
        body: { parts: [{ type: 'text', text, synthetic: true, metadata }, { type: 'text', text, ignored: true, metadata }] },
      });
      if (res?.error) continue;
      const id = res?.data?.info?.parentID;
      if (id) a2aInjected.set(msg.taskId, { id, name });
    } catch { /* claimed but undelivered: the caller's live timeout reports it */ }
  }
  const source = replySourceFor(client, sessionID);
  for (const [taskId, rec] of a2aInjected) {
    if (rec.name !== name) continue;
    const reply = await source({ session: name, taskId });
    if (reply == null) continue;
    const dir = replyDir(name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${taskId}.reply`);
    writeFileSync(file, reply, { mode: 0o600 });
    chmodSync(file, 0o600);
    a2aInjected.delete(taskId);
  }
}
