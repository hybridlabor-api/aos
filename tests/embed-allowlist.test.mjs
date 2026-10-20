import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AO_EMBED_ANCESTORS,
  embedAncestors,
  isAllowedFetchSite,
  isEmbedNavigation,
} from '../skills/global_config/plan-canvas/scripts/lib/loopback-guard.js';
import { createRequire } from 'node:module';
import { createHub } from '../lib/hub/server.mjs';
import { securityHeaders as hubSecurityHeaders, fetchSiteOk as hubFetchSiteOk } from '../lib/hub/guard.mjs';
import { securityHeaders as trailSecurityHeaders, buildCsp as trailBuildCsp, sameOriginFetchSite as trailSameOrigin } from '../skills/global_config/agenttrail/lib/httpguard.mjs';

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
  function homeWith(settings) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-home-'));
    if (settings !== undefined) {
      fs.mkdirSync(path.join(home, '.aos'));
      fs.writeFileSync(path.join(home, '.aos', 'v5-settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
    }
    return home;
  }

  test('loopback-guard: default is empty (opt-in), preset has no dev server', () => {
    const home = homeWith();
    assert.deepEqual(embedAncestors({}, home), []);
    assert.deepEqual(AO_EMBED_ANCESTORS, ['tauri://localhost', 'http://tauri.localhost']);
  });

  test('loopback-guard: settings file enables, env overrides (even empty)', () => {
    const home = homeWith({ embedAncestors: AO_EMBED_ANCESTORS });
    assert.deepEqual(embedAncestors({}, home), AO_EMBED_ANCESTORS);
    assert.deepEqual(embedAncestors({ AOS_EMBED_ANCESTORS: '' }, home), []);
    assert.deepEqual(embedAncestors({ AOS_EMBED_ANCESTORS: 'http://foo.com:8080, https://bar.com' }, home), ['http://foo.com:8080', 'https://bar.com']);
    assert.deepEqual(embedAncestors({}, homeWith('{not json')), []);
    assert.deepEqual(embedAncestors({}, homeWith({ embedAncestors: 'tauri://localhost' })), []);
  });

  test('loopback-guard: invalid entries are dropped', () => {
    const bad = ['*', 'tauri:', 'https:', "'none'", 'none', 'null', 'http://a.com/path', 'http://a.com;x', 'http://a.com"', 'http://a .com', 'http://a.com b', 'http://a.com:', 'http://*.a.com', 'HTTP://A.COM', 42, null];
    const good = 'http://localhost:1420';
    const home = homeWith({ embedAncestors: [...bad, good] });
    assert.deepEqual(embedAncestors({}, home), [good]);
    assert.deepEqual(embedAncestors({ AOS_EMBED_ANCESTORS: bad.filter((x) => typeof x === 'string' && !x.includes(',')).join(',') }, home), []);
  });

  test('profile.js owns and validates embedAncestors', () => {
    const profile = createRequire(import.meta.url)('../lib/v5/profile.js');
    assert.ok(profile.OWNED_KEYS.includes('embedAncestors'));
    const { settings, problems } = profile.sanitizeSettings({ embedAncestors: ['tauri://localhost', '*', 'http://a.com/x'] }, null);
    assert.deepEqual(settings.embedAncestors, ['tauri://localhost']);
    assert.equal(problems.length, 1);
    assert.equal(profile.sanitizeSettings({ embedAncestors: 'x' }, null).settings.embedAncestors, undefined);
  });

  test('bridge copies are byte-identical and hello targets explicit origins', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files = [
      'lib/hub/ui/ao-embed-bridge.js',
      'skills/global_config/agenttrail/public/ao-embed-bridge.js',
      'skills/global_config/agenttrail/public/hub/ao-embed-bridge.js',
      'skills/global_config/plan-canvas/scripts/lib/plan-canvas/ao-embed-bridge.js',
    ].map((f) => fs.readFileSync(path.join(root, f), 'utf8'));
    for (const f of files) assert.equal(f, files[0]);
    assert.doesNotMatch(files[0], /postMessage\([^)]*'\*'\)/);
  });

  test('cross-site requests stay refused by the agenttrail and plan-canvas fetch-site guards', () => {
    assert.equal(trailSameOrigin({ 'sec-fetch-site': 'cross-site' }), false);
    assert.equal(isAllowedFetchSite('cross-site'), false);
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
    assert.equal(hubFetchSiteOk(iframeNav, {}), false, 'opt-in');
    assert.equal(hubFetchSiteOk(iframeNav, { AOS_EMBED_ANCESTORS: 'tauri://localhost' }), true);
    assert.equal(hubFetchSiteOk(iframeNav, { AOS_EMBED_ANCESTORS: '' }), false);

    const apiFetch = { method: 'GET', path: '/api/services', site: 'cross-site', mode: 'cors', dest: 'empty' };
    assert.equal(hubFetchSiteOk(apiFetch, { AOS_EMBED_ANCESTORS: 'tauri://localhost' }), false);

    const postNav = { method: 'POST', path: '/', site: 'cross-site', mode: 'navigate', dest: 'iframe' };
    assert.equal(hubFetchSiteOk(postNav, { AOS_EMBED_ANCESTORS: 'tauri://localhost' }), false);
  });

  test('agenttrail httpguard: securityHeaders dynamically adapts to embed allowlist', () => {
    const fakeRes = {
      headers: {},
      setHeader(name, val) { this.headers[name.toLowerCase()] = val; },
    };

    trailSecurityHeaders(fakeRes, {});
    assert.match(fakeRes.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(fakeRes.headers['x-frame-options'], 'DENY');
    const fakeRes3 = { headers: {}, setHeader(name, val) { this.headers[name.toLowerCase()] = val; } };
    trailSecurityHeaders(fakeRes3, { AOS_EMBED_ANCESTORS: 'tauri://localhost' });
    fakeRes.headers = fakeRes3.headers;
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
      assert.equal((await rawRequest(port, { method: 'GET', pathName: '/', headers: iframeHeaders })).status, 403, 'default: framing refused');
      const oldEnv = process.env.AOS_EMBED_ANCESTORS;
      let res;
      try {
        process.env.AOS_EMBED_ANCESTORS = 'tauri://localhost';
        res = await rawRequest(port, { method: 'GET', pathName: '/', headers: iframeHeaders });
      } finally {
        if (oldEnv === undefined) delete process.env.AOS_EMBED_ANCESTORS;
        else process.env.AOS_EMBED_ANCESTORS = oldEnv;
      }
      assert.equal(res.status, 200);
      assert.match(res.headers['content-security-policy'] || '', /frame-ancestors 'self' [^;]*tauri:\/\/localhost/);
      assert.match(res.body, /<meta name="ao-embed-ancestors" content="tauri:\/\/localhost">/);
      assert.match(res.body, /<script src="ao-embed-bridge\.js"><\/script>/);
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
