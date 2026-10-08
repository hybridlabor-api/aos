import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createHandler, shaToken, resetRateLimit } from '../lib/annotation/protocol.mjs';

const req = createRequire(import.meta.url);
const modelPath = path.resolve('skills/global_config/plan-canvas/scripts/lib/plan-canvas/annotation-model.js');
const model = req(modelPath);

function opts(port, token, extra = {}) {
  return {
    hostname: '127.0.0.1', port, path: '/aos-api/collect?pageId=p1',
    method: 'GET',
    headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, cookie: `aos_ann=${token}` },
    ...extra,
  };
}
function reqOnce(o, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(o, (res) => {
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => resolve({ res, body: Buffer.concat(c) }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

test('protocol: collect ETag/304, redaction, reply idempotency, 404, exporter', { timeout: 8000 }, async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ann-'));
  const token = 't'.repeat(40);
  const handler = createHandler({ stateDir, port: 0, token });
  const server = http.createServer(handler);
  try {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const H = createHandler({ stateDir, port, tokenSha: shaToken(token) });
    server.removeAllListeners('request');
    server.on('request', H);
    resetRateLimit();
    model.addAnnotation(stateDir, 'p1', { type: 'text', authorKind: 'human', authorName: 'a', markup: { text: 'hi sk-abcdefgh12345678' } });
    let r1 = await reqOnce(opts(port, token));
    assert.equal(r1.res.statusCode, 200);
    const j1 = JSON.parse(r1.body.toString());
    assert.ok(!JSON.stringify(j1).includes('sk-abcdefgh12345678'));
    assert.equal(j1.await, 'passthrough');
    model.appendReply(stateDir, 'p1', { annotationId: model.loadThreads(stateDir, 'p1').threads[0].id, body: 'tok Bearer abc123def456ghi789 here', authorKind: 'human', idempotencyKey: 'k-bearer-12345678' });
    resetRateLimit();
    const rB = await reqOnce(opts(port, token));
    assert.ok(!JSON.stringify(rB.body.toString()).includes('Bearer abc123def456ghi789'));
    const etag = rB.res.headers.etag;
    let r304 = await reqOnce({ ...opts(port, token), headers: { ...opts(port, token).headers, 'if-none-match': etag } });
    assert.equal(r304.res.statusCode, 304);
    const threads = model.loadThreads(stateDir, 'p1').threads;
    const id = threads[0].id;
    const payload = JSON.stringify({ pageId: 'p1', annotationId: id, body: 'x', authorKind: 'human', idempotencyKey: 'k-12345678' });
    const po = { hostname: '127.0.0.1', port, path: '/aos-api/reply', method: 'POST', headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, cookie: `aos_ann=${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } };
    const a = JSON.parse((await reqOnce({ ...po }, payload)).body.toString());
    const b = JSON.parse((await reqOnce({ ...po }, payload)).body.toString());
    assert.equal(b.duplicate, true);
    assert.equal(model.readEvents(stateDir, 'p1').events.filter((e) => e.kind === 'reply' && e.idempotencyKey === 'k-12345678').length, 1);
    const nf = await reqOnce({ ...opts(port, token), path: '/aos-api/exec', method: 'POST' });
    assert.equal(nf.res.statusCode, 404);
    const { copyForAi } = await import('../lib/annotation/protocol.mjs');
    const md = copyForAi(j1.threads);
    assert.ok(typeof md === 'string' && md.includes('unverified'));
  } finally {
    server.close();
  }
});
