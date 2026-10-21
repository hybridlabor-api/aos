import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { redact } from '../lib/evolve/redact.mjs';

describe('AOS Evolve Redaction Engine (WP2)', () => {
  test('strips current user home directory from paths', () => {
    const home = os.homedir();
    const input = `Error reading file at ${home}/dev/bdb-dev/secret.txt`;
    const result = redact(input);

    assert.ok(!result.includes(home), 'result must not contain actual home directory');
    assert.ok(result.includes('~/dev/bdb-dev/secret.txt'), 'result must replace home with ~');
  });

  test('strips generic /Users/<user> and /home/<user> paths', () => {
    const macPath = 'Failed at /Users/johndoe/project/repo/index.js:42:10';
    const linuxPath = 'Exception in /home/alice_smith/.config/app.json';
    const winPath = 'Traceback at C:\\Users\\bob.builder\\AppData\\Local\\Temp\\run.log';

    const macRedacted = redact(macPath);
    const linuxRedacted = redact(linuxPath);
    const winRedacted = redact(winPath);

    assert.ok(!macRedacted.includes('/Users/johndoe'), 'mac path user must be redacted');
    assert.ok(macRedacted.includes('~/project/repo/index.js'), 'mac path converted to ~ relative');

    assert.ok(!linuxRedacted.includes('/home/alice_smith'), 'linux path user must be redacted');
    assert.ok(linuxRedacted.includes('~/.config/app.json'), 'linux path converted to ~ relative');

    assert.ok(!winRedacted.includes('C:\\Users\\bob.builder'), 'windows path user must be redacted');
    assert.ok(winRedacted.includes('~\\AppData\\Local\\Temp\\run.log'), 'windows path converted to ~ relative');
  });

  test('redacts OpenAI / Anthropic API keys (sk-...)', () => {
    const input = 'Encountered 401 with authorization key sk-ant-api03-abcdef1234567890abcdef1234567890';
    const result = redact(input);

    assert.ok(!result.includes('sk-ant-api03-abcdef1234567890abcdef1234567890'));
    assert.ok(result.includes('***REDACTED***'));
  });

  test('redacts GitHub Personal Access Tokens (ghp_... and github_pat_...)', () => {
    const input1 = 'Failed to fetch repo: token ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    const input2 = 'Remote auth: github_pat_11AAAAAAA01234567890abcdefghijklmnopqrstuvwxyz';

    const res1 = redact(input1);
    const res2 = redact(input2);

    assert.ok(!res1.includes('ghp_1234567890abcdefghijklmnopqrstuvwxyz'));
    assert.ok(res1.includes('***REDACTED***'));

    assert.ok(!res2.includes('github_pat_11AAAAAAA01234567890abcdefghijklmnopqrstuvwxyz'));
    assert.ok(res2.includes('***REDACTED***'));
  });

  test('redacts Slack tokens (xoxb-...) and AWS access keys (AKIA...)', () => {
    const input = 'Credentials found: slack=xoxb-1234567890-abcdefghijklmnop and aws=AKIAIOSFODNN7EXAMPLE';
    const result = redact(input);

    assert.ok(!result.includes('xoxb-1234567890-abcdefghijklmnop'));
    assert.ok(!result.includes('AKIAIOSFODNN7EXAMPLE'));
    assert.ok(result.includes('***REDACTED***'));
  });

  test('redacts Bearer and Basic authentication headers', () => {
    const bearer = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature123';
    const basic = 'Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQxMjM=';

    const resBearer = redact(bearer);
    const resBasic = redact(basic);

    assert.ok(!resBearer.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature123'));
    assert.ok(resBearer.includes('Bearer ***REDACTED***'));

    assert.ok(!resBasic.includes('dXNlcm5hbWU6cGFzc3dvcmQxMjM='));
    assert.ok(resBasic.includes('Basic ***REDACTED***'));
  });

  test('redacts environment variable secret assignments', () => {
    const envString = 'Setting environment: API_KEY=my_super_secret_value_12345 and SECRET_TOKEN="secret_token_val_9999"';
    const result = redact(envString);

    assert.ok(!result.includes('my_super_secret_value_12345'));
    assert.ok(!result.includes('secret_token_val_9999'));
    assert.ok(result.includes('API_KEY=***REDACTED***'));
    assert.ok(result.includes('SECRET_TOKEN=***REDACTED***'));
  });

  test('redacts PEM private key blocks', () => {
    const pem = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+abcdefghijklmnopqrstuvwxyz1234567890
-----END RSA PRIVATE KEY-----`;

    const result = redact(pem);
    assert.ok(!result.includes('MIIEowIBAAKCAQEA0Y1'));
    assert.ok(result.includes('[REDACTED_PRIVATE_KEY]'));
  });

  test('handles non-string and empty inputs gracefully', () => {
    assert.equal(redact(null), '');
    assert.equal(redact(undefined), '');
    assert.equal(redact(12345), '12345');
    assert.equal(redact(''), '');
  });

  test('preserves benign paths and text without false positives', () => {
    const safeText = 'Compiled /usr/local/bin/node in 350ms for project at ./skills/clean-code';
    const result = redact(safeText);
    assert.equal(result, safeText);
  });
});
