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

  test('redacts OpenAI / Anthropic API keys (sk-... and sk_live_...)', () => {
    const input1 = 'Encountered 401 with authorization key sk-ant-api03-abcdef1234567890abcdef1234567890';
    const input2 = 'Stripe key found: sk_live_51Abcdef1234567890abcdef123456';
    const res1 = redact(input1);
    const res2 = redact(input2);

    assert.ok(!res1.includes('sk-ant-api03-abcdef1234567890abcdef1234567890'));
    assert.ok(res1.includes('***REDACTED***'));
    assert.ok(!res2.includes('sk_live_51Abcdef1234567890abcdef123456'));
    assert.ok(res2.includes('***REDACTED***'));
  });

  test('redacts Google Cloud API keys (AIza...)', () => {
    const input = 'Request failed: key AIzaSyD1234567890abcdefghijklmnopqrstuv';
    const result = redact(input);

    assert.ok(!result.includes('AIzaSyD1234567890abcdefghijklmnopqrstuv'));
    assert.ok(result.includes('***REDACTED***'));
  });

  test('redacts URL embedded credentials (scheme://user:pass@host)', () => {
    const httpUrl = 'Failed to fetch from https://admin:SuperSecretPass123@api.example.com/v1/data';
    const pgUrl = 'Database connection error: postgres://postgres_user:my_db_password_999@localhost:5432/production';

    const resHttp = redact(httpUrl);
    const resPg = redact(pgUrl);

    assert.ok(!resHttp.includes('admin:SuperSecretPass123'));
    assert.ok(resHttp.includes('https://[REDACTED_AUTH]@api.example.com'));

    assert.ok(!resPg.includes('postgres_user:my_db_password_999'));
    assert.ok(resPg.includes('postgres://[REDACTED_AUTH]@localhost:5432'));
  });

  test('redacts JSON-quoted secrets and keys', () => {
    const jsonStr = 'Payload: {"apiKey":"abcdefgh12", "secretToken": "secret_val_99", "password":"myPassword!"}';
    const result = redact(jsonStr);

    assert.ok(!result.includes('abcdefgh12'), 'apiKey value must be redacted');
    assert.ok(!result.includes('secret_val_99'), 'secretToken value must be redacted');
    assert.ok(!result.includes('myPassword!'), 'password value must be redacted');
    assert.ok(result.includes('"apiKey": "***REDACTED***"'));
  });

  test('redacts short .env format values', () => {
    const envData = `API_KEY=foo
SECRET=123
AUTH_TOKEN=bar
PASS=xyz`;
    const result = redact(envData);

    assert.ok(!result.includes('foo'));
    assert.ok(!result.includes('123'));
    assert.ok(!result.includes('bar'));
    assert.ok(!result.includes('xyz'));
    assert.ok(result.includes('API_KEY=***REDACTED***'));
    assert.ok(result.includes('SECRET=***REDACTED***'));
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
  test("redacts unquoted secrets and keys (YAML, CLI, logs)", () => {
    const yaml1 = "password: hunter2";
    const yaml2 = "apiKey: abcdefgh123456";
    const res1 = redact(yaml1);
    const res2 = redact(yaml2);

    assert.ok(!res1.includes("hunter2"));
    assert.ok(res1.includes("password: ***REDACTED***"));
    assert.ok(!res2.includes("abcdefgh123456"));
    assert.ok(res2.includes("apiKey: ***REDACTED***"));
  });

  test("redacts object assignments with dot notation", () => {
    const js1 = "config.password = \"secretPass123\"";
    const js2 = "app.settings.apiKey = 'xyz789'";
    const js3 = "user.token = unquotedTokenVal";

    const res1 = redact(js1);
    const res2 = redact(js2);
    const res3 = redact(js3);

    assert.ok(!res1.includes("secretPass123"));
    assert.ok(res1.includes("config.password = \"***REDACTED***\""));
    assert.ok(!res2.includes("xyz789"));
    assert.ok(res2.includes("app.settings.apiKey = '***REDACTED***'"));
    assert.ok(!res3.includes("unquotedTokenVal"));
    assert.ok(res3.includes("user.token = ***REDACTED***"));
  });

  test("redacts complex URL credentials with special characters in secret", () => {
    const pgComplex = "postgres://app:" + "p@ss/word" + "@db";
    const resPg = redact(pgComplex);

    assert.ok(!resPg.includes("p@ss/word"));
    assert.ok(!resPg.includes("app:"));
    assert.equal(resPg, "postgres://[REDACTED_AUTH]" + "@db");

    const pgWithPortAndPath = "postgres://app:" + "p@ss/word" + "@db:5432/mydb";
    const resWithPort = redact(pgWithPortAndPath);
    assert.equal(resWithPort, "postgres://[REDACTED_AUTH]" + "@db:5432/mydb");
  });

  test("avoids false positives: author and authority are preserved while auth and authToken are redacted", () => {
    const input1 = "author: \"Tim Rennings\"";
    const input2 = "author: hunter2";
    const input3 = "config.author = \"Alice\"";
    const input4 = "authority: \"admin\"";

    assert.equal(redact(input1), input1, "author with quoted string must not be redacted");
    assert.equal(redact(input2), input2, "author with unquoted string must not be redacted");
    assert.equal(redact(input3), input3, "config.author must not be redacted");
    assert.equal(redact(input4), input4, "authority must not be redacted");

    const auth1 = "auth: \"secretToken\"";
    const auth2 = "authToken: \"secretToken\"";
    const auth3 = "AUTH_SECRET=secret123";

    assert.ok(!redact(auth1).includes("secretToken"));
    assert.ok(!redact(auth2).includes("secretToken"));
    assert.ok(!redact(auth3).includes("secret123"));
  });
});
