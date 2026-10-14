import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSiteOk, FlightLock, confirmOk, contentTypeJson, hostOk, newToken, originOk, securityHeaders, shaToken, tokenOk } from '../lib/hub/guard.mjs';
import { redact } from '../lib/hub/redact.mjs';

test('host: exact host:port only', () => {
  assert.ok(hostOk('127.0.0.1:7900', 7900));
  assert.ok(hostOk('localhost:7900', 7900));
  assert.equal(hostOk('evil.com:7900', 7900), false);
  assert.equal(hostOk('127.0.0.1:7901', 7900), false);
  assert.equal(hostOk('', 7900), false);
  assert.equal(hostOk('127.0.0.1', 7900), false);
});

test('origin: absent or exactly the hub origin', () => {
  assert.ok(originOk(undefined, 7900));
  assert.ok(originOk('', 7900));
  assert.ok(originOk('http://127.0.0.1:7900', 7900));
  assert.ok(originOk('http://localhost:7900', 7900));
  assert.equal(originOk('http://127.0.0.1:4519', 7900), false);
  assert.equal(originOk('http://evil.example', 7900), false);
  assert.equal(originOk('null', 7900), false);
});

test('sec-fetch-site: exemptions only for static reads and top navigation', () => {
  const allow = (o) => fetchSiteOk(o);
  // plain same-origin
  assert.ok(allow({ method: 'GET', path: '/', site: 'same-origin', mode: 'cors', dest: 'empty' }));
  assert.ok(allow({ method: 'POST', path: '/api/x', site: 'same-origin' }));
  assert.ok(allow({ method: 'GET', path: '/api/plans', site: undefined, mode: undefined, dest: undefined }));
  // top-level navigation exemption
  assert.ok(allow({ method: 'GET', path: '/', site: 'same-site', mode: 'navigate', dest: 'document' }));
  assert.ok(allow({ method: 'GET', path: '/', site: 'cross-site', mode: 'navigate', dest: 'document' }));
  // framed load from another site: allowed when allowlist active, refused when empty
  assert.equal(allow({ method: 'GET', path: '/', site: 'same-site', mode: 'navigate', dest: 'iframe' }), true);
  assert.equal(fetchSiteOk({ method: 'GET', path: '/', site: 'same-site', mode: 'navigate', dest: 'iframe' }, { AOS_EMBED_ANCESTORS: '' }), false);
  assert.equal(allow({ method: 'POST', path: '/', site: 'same-site', mode: 'navigate', dest: 'document' }), false);
  // static reads exemption
  assert.ok(allow({ method: 'GET', path: '/ui/app.js', site: 'same-site', mode: 'no-cors', dest: 'script' }));
  assert.equal(allow({ method: 'GET', path: '/api/plans', site: 'same-site', mode: 'no-cors', dest: 'empty' }), false);
  assert.equal(allow({ method: 'PUT', path: '/ui/app.js', site: 'same-site', mode: 'no-cors', dest: 'script' }), false);
  // unknown sites refused
  assert.equal(allow({ method: 'GET', path: '/', site: 'nested', mode: 'navigate', dest: 'document' }), false);
});

test('token: sha256 + timingSafeEqual comparison', () => {
  const token = newToken();
  const good = shaToken(token);
  assert.ok(newToken().length >= 64);
  assert.ok(tokenOk(token, good));
  assert.equal(tokenOk('', good), false);
  assert.equal(tokenOk('nope', good), false);
  assert.equal(tokenOk(token, 'x'.repeat(64)), false);
});

test('content-type json check', () => {
  assert.ok(contentTypeJson({ headers: { 'content-type': 'application/json' } }));
  assert.ok(contentTypeJson({ headers: { 'content-type': 'application/json; charset=utf-8' } }));
  assert.equal(contentTypeJson({ headers: { 'content-type': 'text/plain' } }), false);
  assert.equal(contentTypeJson({ headers: {} }), false);
});

test('confirm: typed repetition is required', () => {
  assert.ok(confirmOk({ confirm: 'hub' }, 'hub'));
  assert.equal(confirmOk({}, 'hub'), false);
  assert.equal(confirmOk({ confirm: 'other' }, 'hub'), false);
  assert.equal(confirmOk(null, 'hub'), false);
});

test('FlightLock: single-flight returns false for a second lock', async () => {
  const locks = new FlightLock();
  assert.ok(locks.tryLock('services'));
  assert.equal(locks.tryLock('services'), false);
  assert.equal(locks.run('services', async () => 1), false);
  locks.release('services');
  assert.equal(await locks.run('services', async () => 42), 42);
});

test('security headers: CSP frame-ancestors allowlist / none, no unsafe-inline', () => {
  const h = securityHeaders();
  assert.match(h['content-security-policy'], /frame-ancestors 'self' [^;]*tauri:\/\/localhost/);
  const hNone = securityHeaders({ AOS_EMBED_ANCESTORS: '' });
  assert.match(hNone['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(h['content-security-policy'], /default-src 'self'/);
  assert.match(h['content-security-policy'], /base-uri 'none'/);
  assert.match(h['content-security-policy'], /form-action 'none'/);
  assert.doesNotMatch(h['content-security-policy'], /unsafe-inline/);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['cache-control'], 'no-store');
  assert.equal(h['referrer-policy'], 'no-referrer');
});

test('redact: tokens, keys, bearer values', () => {
  for (const secret of [
    'ghp_ABCDEFGHIJK0123456789',
    'github_pat_ABCDEFghi_1234567890ABCDEFg',
    'sk-abcdefGHIJK1234567890',
    'xoxb-123456789012-12345',
    'AIzaSyAabcdefGHIJKLmnop1234567890abcde',
    'Bearer abc.def_g-123456',
  ]) {
    const out = redact(`line ${secret} tail`);
    assert.equal(out, 'line [redacted] tail', secret);
  }
  const hex = redact(`line ${'a'.repeat(64)} tail`);
  assert.equal(hex, 'line [redacted-hex64] tail');
  assert.match(redact('GITHUB_PERSONAL_ACCESS_TOKEN=ghp_x'), /GITHUB_PERSONAL_ACCESS_TOKEN=\[redacted\]/);
  assert.match(redact('MY_SECRET: super'), /MY_SECRET: \[redacted\]/);
  assert.match(redact('X_API_KEY=abc'), /X_API_KEY=\[redacted\]/);
  assert.match(redact('session_token="abc"'), /session_token="?\[redacted\]/);
  // harmless assignment survives
  assert.equal(redact('count=5'), 'count=5');
  assert.doesNotMatch(redact('echo "echo hi"'), /redacted/);
  const hexRedacted = redact('prefix 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef suffix');
  assert.match(hexRedacted, /\[redacted-hex64\]/);
});

test('redact: mid-line assignments, argv pairs, userinfo, JWTs, Authorization headers', () => {
  // mid-line / query-string assignments
  assert.match(redact('fetch https://api.x/v1?ids=1&token=sup3rS3cret&pages=2'), /token=\[redacted\]/);
  assert.doesNotMatch(redact('fetch https://api.x/v1?ids=1&token=sup3rS3cret&pages=2'), /sup3rS3cret/);
  assert.match(redact('curl --token=abc1234 def'), /--token=\[redacted\]/);
  assert.match(redact('{"apikey":"sv-value-9"}'), /apikey"?:"?\[redacted\]/);
  assert.doesNotMatch(redact('password: p4ssword123'), /p4ssword123/);
  // assert.ok kept for the value that must survive
  assert.equal(redact('retry=3'), 'retry=3');
  // argv value pairs (kept value-free)
  assert.match(redact('preview od-auth --api-key AKVA123 --debug'), /--api-key .*[redacted]/);
  assert.equal(redact('preview od-auth --api-key AKVA123 --debug').includes('AKVA123'), false);
  assert.match(redact('run --secret two-words-tok'), /--secret\s+\[redacted\]/);
  // URL userinfo user:pass
  const ui = redact('clone https://gituser:gmailpass@github.com/a/b.git or http://u:verysecret@x.local/');
  assert.match(ui, /https:\/\/\[redacted\]:\[redacted\]@github\.com/);
  assert.doesNotMatch(ui, /verysecret/);
  // JWT three base64url parts starting eyJ
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQsssIc';
  const outJwt = redact(`header authorization sees ${jwt} done`);
  assert.match(outJwt, /\[redacted-jwt\]/);
  assert.equal(outJwt.includes('SflKxwRJSMe'), false);
  // Authorization header with a scheme that is not caught by the Bearer pattern
  const auth = redact('Authorization: Snoken 3eafa9ff11');
  assert.match(auth, /Authorization: \S+ \[redacted\]/);
  assert.equal(auth.includes('3eafa9ff11'), false);
  // harmless text survives
  assert.equal(redact('visited token status page'), 'visited token status page');
});
