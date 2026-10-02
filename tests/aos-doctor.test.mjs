import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const doctorScript = path.join(__dirname, '..', 'bin', 'aos-doctor.mjs');

test('aos-doctor: outputs valid JSON structure with --json', () => {
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [doctorScript, '--json'], { encoding: 'utf8' });
  } catch (err) {
    // Exit code might be 1 if local system has a warning or missing component,
    // but stdout must still be valid JSON.
    stdout = err.stdout;
  }

  assert.ok(stdout, 'Doctor should produce output');
  const data = JSON.parse(stdout);
  assert.equal(typeof data.ok, 'boolean');
  assert.equal(typeof data.platform, 'string');
  assert.equal(typeof data.arch, 'string');
  assert.ok(Array.isArray(data.results), 'results should be an array');
  assert.ok(data.results.length >= 10, 'should perform at least 10 diagnostic checks');

  const areas = new Set(data.results.map(r => r.area));
  assert.ok(areas.has('prereq'), 'must check prereqs');
  assert.ok(areas.has('aos-core'), 'must check aos-core');
  assert.ok(areas.has('harnesses'), 'must check harnesses');
  assert.ok(areas.has('hooks'), 'must check hooks');
  assert.ok(areas.has('daemons'), 'must check daemons');
});

test('aos-doctor: verifies AO presence and daemon reporting', () => {
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [doctorScript, '--json'], { encoding: 'utf8' });
  } catch (err) {
    stdout = err.stdout;
  }

  const data = JSON.parse(stdout);
  const aoCheck = data.results.find(r => r.name.includes('AO Agent Orchestrator'));
  assert.ok(aoCheck, 'Doctor must include AO Agent Orchestrator check');
  assert.ok(typeof aoCheck.detail === 'string');
});

test('aos-doctor: distinguishes offline mode from --net registry check', () => {
  let stdoutOffline = '';
  try {
    stdoutOffline = execFileSync(process.execPath, [doctorScript, '--json'], { encoding: 'utf8' });
  } catch (err) {
    stdoutOffline = err.stdout;
  }
  const dataOffline = JSON.parse(stdoutOffline);
  const npmOfflineCheck = dataOffline.results.find(r => r.name === 'Version vs npm');
  assert.ok(npmOfflineCheck, 'Doctor must include Version vs npm check');
  assert.match(npmOfflineCheck.detail, /Skipped/i);
});

test('aos-doctor: executes registry check when --net is passed', () => {
  let stdoutNet = '';
  try {
    stdoutNet = execFileSync(process.execPath, [doctorScript, '--json', '--net'], { encoding: 'utf8' });
  } catch (err) {
    stdoutNet = err.stdout;
  }
  const dataNet = JSON.parse(stdoutNet);
  const npmNetCheck = dataNet.results.find(r => r.name === 'Version vs npm');
  assert.ok(npmNetCheck, 'Doctor must include Version vs npm check');
  assert.doesNotMatch(npmNetCheck.detail, /Skipped \(offline mode/i);
  assert.match(npmNetCheck.detail, /local v[\d.]+\s*·\s*npm v[\d.]+/i);
});

import fs from 'node:fs';
import os from 'node:os';

function doctorWithOpencodeConfig(configText, name = 'opencode.jsonc') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-doctor-oc-'));
  try {
    if (configText !== null) {
      fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
      fs.writeFileSync(path.join(home, '.config', 'opencode', name), configText);
    }
    let stdout;
    try {
      stdout = execFileSync(process.execPath, [doctorScript, '--json'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home } });
    } catch (err) { stdout = err.stdout; }
    return JSON.parse(stdout).results.find((r) => r.name === 'OpenCode MCP names');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('aos-doctor: warns about OpenCode MCP names over 64 characters (names only, JSONC ok)', () => {
  const long = 'x'.repeat(65);
  const r = doctorWithOpencodeConfig(`// comment\n{\n  /* block */ "mcp": { "memb": { "type": "local" }, "${long}": { "type": "local", "url": "http://a//b" }, },\n}\n`);
  assert.equal(r.ok, false);
  assert.equal(r.warningOnly, true);
  assert.ok(r.detail.includes(long));
  assert.ok(!r.detail.includes('memb'));
});

test('aos-doctor: OpenCode MCP names within 64 characters pass; no config means no check', () => {
  const ok = doctorWithOpencodeConfig(JSON.stringify({ mcp: { memb: {}, ['y'.repeat(64)]: {} } }), 'opencode.json');
  assert.equal(ok.ok, true);
  assert.equal(doctorWithOpencodeConfig(null), undefined);
});

test('aos-doctor: an unreadable OpenCode config is a warning, not a crash', () => {
  const r = doctorWithOpencodeConfig('{ "mcp": ');
  assert.equal(r.ok, false);
  assert.equal(r.warningOnly, true);
});
