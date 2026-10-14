import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_EMBED_ANCESTORS,
  embedAncestors,
  isEmbedNavigation,
} from '../skills/global_config/plan-canvas/scripts/lib/loopback-guard.js';
import { createHub } from '../lib/hub/server.mjs';
import { securityHeaders as hubSecurityHeaders, fetchSiteOk as hubFetchSiteOk } from '../lib/hub/guard.mjs';
import { securityHeaders as trailSecurityHeaders, buildCsp as trailBuildCsp } from '../skills/global_config/agenttrail/lib/httpguard.mjs';

function rawRequest(port, { method = 'GET', pathName = '/', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        method,
        agent: false,
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Embed Allowlist & Bridge Contract', () => {
  test('loopback-guard: embedAncestors default and environment override', () => {
    assert.deepEqual(embedAncestors({}), DEFAULT_EMBED_ANCESTORS);
    assert.deepEqual(embedAncestors({ AOS_EMBED_ANCESTORS: '' }), []);
    assert.deepEqual(
      embedAncestors({ AOS_EMBED_ANCESTORS: 'http://foo.com, https://bar.com' }),
      ['http://foo.com', 'https://bar.com']
    );
  });

  test('loopback-guard: isEmbedNavigation detects iframe navigation headers', () => {
    assert.equal(
      isEmbedNavigation({ 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' }),
      true
    );
    assert.equal(
      isEmbedNavigation({ 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' }),
      false
    );
    assert.equal(
      isEmbedNavigation({ 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' }),
      false
    );
    assert.equal(isEmbedNavigation(null), false);
  });

  test('hub guard: fetchSiteOk allows embed navigation only when allowlist is active', () => {
    const iframeNav = { method: 'GET', path: '/', site: 'cross-site', mode: 'navigate', dest: 'iframe' };
    assert.equal(hubFetchSiteOk(iframeNav, {}), true);
    assert.equal(hubFetchSiteOk(iframeNav, { AOS_EMBED_ANCESTORS: '' }), false);

    const apiFetch = { method: 'GET', path: '/api/services', site: 'cross-site', mode: 'cors', dest: 'empty' };
    assert.equal(hubFetchSiteOk(apiFetch, {}), false);

    const postNav = { method: 'POST', path: '/', site: 'cross-site', mode: 'navigate', dest: 'iframe' };
    assert.equal(hubFetchSiteOk(postNav, {}), false);
  });

  test('agenttrail httpguard: securityHeaders dynamically adapts to embed allowlist', () => {
    const fakeRes = {
      headers: {},
      setHeader(name, val) { this.headers[name.toLowerCase()] = val; },
    };

    trailSecurityHeaders(fakeRes, {});
    assert.match(fakeRes.headers['content-security-policy'], /frame-ancestors 'self' [^;]*tauri:\/\/localhost/);
    assert.equal(fakeRes.headers['x-frame-options'], undefined);

    const fakeRes2 = {
      headers: {},
      setHeader(name, val) { this.headers[name.toLowerCase()] = val; },
    };
    trailSecurityHeaders(fakeRes2, { AOS_EMBED_ANCESTORS: '' });
    assert.equal(fakeRes2.headers['content-security-policy'], "default-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    assert.equal(fakeRes2.headers['x-frame-options'], 'DENY');
  });

  describe('AOS Hub embed routes and bridge integration', () => {
    let hub;
    let port;

    before(async () => {
      hub = createHub({ port: 0 });
      await hub.listen();
      port = hub.server.address().port;
    });

    after(async () => {
      if (hub) await hub.close();
    });

    test('(a) GET / with embed navigation headers returns 200, frame-ancestors, meta and bridge script', async () => {
      const iframeHeaders = {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'iframe',
      };
      const res = await rawRequest(port, { method: 'GET', pathName: '/', headers: iframeHeaders });
      assert.equal(res.status, 200);
      assert.match(res.headers['content-security-policy'] || '', /frame-ancestors 'self' [^;]*tauri:\/\/localhost/);
      assert.match(res.body, /<meta name="ao-embed-ancestors"/);
      assert.match(res.body, /<script src="\/ao-embed-bridge\.js"><\/script>/);
    });

    test('(b) GET on API route with cors / empty dest from cross-site returns 403', async () => {
      const fetchHeaders = {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      };
      const res = await rawRequest(port, { method: 'GET', pathName: '/api/catalog', headers: fetchHeaders });
      assert.equal(res.status, 403);
    });

    test('(c) With AOS_EMBED_ANCESTORS="" -> iframe-GET / returns 403', async () => {
      const iframeHeaders = {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'iframe',
      };
      const oldEnv = process.env.AOS_EMBED_ANCESTORS;
      try {
        process.env.AOS_EMBED_ANCESTORS = '';
        const res = await rawRequest(port, { method: 'GET', pathName: '/', headers: iframeHeaders });
        assert.equal(res.status, 403);
      } finally {
        if (oldEnv === undefined) delete process.env.AOS_EMBED_ANCESTORS;
        else process.env.AOS_EMBED_ANCESTORS = oldEnv;
      }
    });

    test('(d) POST cross-site returns 403', async () => {
      const postHeaders = {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'content-type': 'application/json',
      };
      const res = await rawRequest(port, {
        method: 'POST',
        pathName: '/api/services/ao/start',
        headers: postHeaders,
        body: JSON.stringify({ confirm: 'ao' }),
      });
      assert.equal(res.status, 403);
    });

    test('(e) GET /ao-embed-bridge.js serves the bridge script with application/javascript', async () => {
      const res = await rawRequest(port, { method: 'GET', pathName: '/ao-embed-bridge.js' });
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /application\/javascript/);
      assert.match(res.body, /ao\.embed\.hello/);
      assert.match(res.body, /ao\.embed\.set-zoom/);
    });
  });
});
