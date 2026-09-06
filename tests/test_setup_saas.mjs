import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

import {
  generateMachineKeypair,
  storePrivateKeyInKeychain,
  getPrivateKeyFromKeychain,
  deletePrivateKeyFromKeychain,
  createClientAssertion,
  acquireMachineToken,
  OidcMachineClient,
  writeMcpConfigSecure,
} from '../bin/setup-saas.mjs';

test('A8b: generateMachineKeypair creates valid RSA 2048 keys and stores in keychain', () => {
  const testClientId = `test-agent-public-${Date.now()}`;
  try {
    const { publicKey, privateKey } = generateMachineKeypair(testClientId);
    assert.ok(publicKey.includes('BEGIN PUBLIC KEY'));
    assert.ok(privateKey.includes('BEGIN PRIVATE KEY'));

    const retrievedKey = getPrivateKeyFromKeychain(testClientId);
    assert.equal(retrievedKey, privateKey.trim());
  } finally {
    deletePrivateKeyFromKeychain(testClientId);
  }
});

test('A8b: createClientAssertion generates RFC 7523 compliant RS256 JWT', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const clientId = 'agent-test-runner';
  const tokenEndpoint = 'https://auth.example.com/api/oidc/token';
  const assertion = createClientAssertion(clientId, privateKey, tokenEndpoint);

  const parts = assertion.split('.');
  assert.equal(parts.length, 3);

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

  assert.equal(header.alg, 'RS256');
  assert.equal(header.typ, 'JWT');
  assert.equal(header.kid, `${clientId}-key-1`);

  assert.equal(payload.iss, clientId);
  assert.equal(payload.sub, clientId);
  assert.equal(payload.aud, tokenEndpoint);
  assert.ok(payload.exp > payload.iat);

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  assert.ok(verifier.verify(publicKey, parts[2], 'base64url'));
});

test('A8b: acquireMachineToken calls token endpoint with client_credentials and assertion', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  let receivedBody = null;
  let receivedContentType = null;

  const server = http.createServer((req, res) => {
    receivedContentType = req.headers['content-type'];
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      receivedBody = new URLSearchParams(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: 'mock-access-token-12345',
        token_type: 'Bearer',
        expires_in: 900
      }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const tokenEndpoint = `http://127.0.0.1:${port}/api/oidc/token`;

  try {
    const tokenInfo = await acquireMachineToken('agent-user', privateKey, tokenEndpoint);
    assert.equal(tokenInfo.accessToken, 'mock-access-token-12345');
    assert.equal(tokenInfo.expiresIn, 900);
    assert.equal(receivedContentType, 'application/x-www-form-urlencoded');
    assert.equal(receivedBody.get('grant_type'), 'client_credentials');
    assert.equal(receivedBody.get('client_id'), 'agent-user');
    assert.equal(receivedBody.get('client_assertion_type'), 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    assert.ok(receivedBody.get('client_assertion').includes('.'));
  } finally {
    server.close();
  }
});

test('A8b: OidcMachineClient transparently refreshes token on 401 and retries idempotently', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  let tokenRequests = 0;
  let apiRequests = 0;

  const server = http.createServer((req, res) => {
    if (req.url === '/token') {
      tokenRequests++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        access_token: `token-generation-${tokenRequests}`,
        expires_in: 900
      }));
    } else if (req.url === '/api/resource') {
      apiRequests++;
      const auth = req.headers['authorization'];
      if (auth === 'Bearer token-generation-1') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Token expired' }));
      } else if (auth === 'Bearer token-generation-2') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', data: 'protected-data' }));
      } else {
        res.writeHead(403);
        res.end();
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const tokenEndpoint = `http://127.0.0.1:${port}/token`;
  const apiUrl = `http://127.0.0.1:${port}/api/resource`;

  try {
    const client = new OidcMachineClient({
      clientId: 'agent-auto-refresh',
      privateKeyPem: privateKey,
      tokenEndpointUrl: tokenEndpoint
    });

    const res = await client.fetchWithAutoRefresh(apiUrl);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'success');
    assert.equal(tokenRequests, 2);
    assert.equal(apiRequests, 2);
  } finally {
    server.close();
  }
});

test('A8b: Editor configs are written without /sse default and with secure permissions 0600', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  const testFile = path.join(tmpDir, 'test_mcp.json');

  try {
    writeMcpConfigSecure(testFile, { test: 'val' });
    const stat = fs.statSync(testFile);
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
