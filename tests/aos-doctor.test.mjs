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
