// V13 Fix 4, install-simulation: after `npm i -g` the ~/.agents/{lib,bin} copies have no
// node_modules beside them. The installer records the package root in
// ~/.agents/lib/.aos-package-root.json and lib/a2a-sdk-resolve.mjs requires the A2A SDK
// (and express) from there, so `aos-a2a status` / `aos-a2a send` resolve deps instead of
// printing "A2A SDK missing". Needs the real npm pack/install, so container-only.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execSync } = require('child_process');

const SANDBOX_SKIP = process.env.AOS_TEST_SANDBOX !== 'container' && 'needs AOS_TEST_SANDBOX=container (npm pack + npm i -g)';
const REPO = path.resolve(__dirname, '..');
const NAME = require(path.join(REPO, 'package.json')).name;

function tmp(dir) {
  return fs.mkdtempSync(path.join(os.tmpdir(), dir));
}

describe('A2A runtime resolves deps from the package dir (installed copies)', () => {
  if (SANDBOX_SKIP) {
    test.skip('npm pack -> npm i -g -> installGlobalBinaries -> installed launcher', { skip: SANDBOX_SKIP });
    return;
  }

  test('pack + global install: launcher boots and resolves @a2a-js/sdk from the recorded package root', () => {
    const out = tmp('a2a-pack-');
    const home = tmp('a2a-pack-home-');
    const packed = spawnSync('npm', ['pack', '--pack-destination', out], { cwd: REPO, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const tgzFile = path.join(out, packed.stdout.trim().split('\n').pop());
    assert.ok(fs.existsSync(tgzFile) && tgzFile.endsWith('.tgz'), tgzFile);

    // container: npm ci already fetched every dep into the npm cache, so --prefer-offline
    // resolves the dependencies for the global install without touching the registry.
    const gi = spawnSync('npm', ['install', '-g', tgzFile, '--prefer-offline', '--no-audit', '--no-fund'], { encoding: 'utf8' });
    assert.equal(gi.status, 0, gi.stderr);
    const globalRoot = execSync('npm root -g').toString().trim();
    const pkgDir = path.join(globalRoot, NAME);
    assert.ok(fs.existsSync(path.join(pkgDir, 'installer.js')), `installed package not found at ${pkgDir}`);

    // The installer step that lands lib/ + bin/ in ~/.agents and wires the launchers.
    const script = `const i=require(${JSON.stringify(path.join(pkgDir, 'installer.js'))});i.installGlobalBinaries();console.log('BIN_OK')`;
    const bins = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.equal(bins.status, 0, `${bins.stderr} ${bins.stdout}`);
    assert.match(bins.stdout, /BIN_OK/);

    // Record + resolver side effect of the step under test:
    const recordPath = path.join(home, '.agents', 'lib', '.aos-package-root.json');
    assert.ok(fs.existsSync(recordPath), 'installer must record the package root beside the copies');
    const recorded = JSON.parse(fs.readFileSync(recordPath, 'utf8')).packageRoot;
    assert.equal(path.resolve(recorded), path.resolve(pkgDir));

    const resolveRun = spawnSync(process.execPath, ['-e',
      `const { a2aImport } = await import(${JSON.stringify(path.join(home, '.agents', 'lib', 'a2a-sdk-resolve.mjs'))});
       const sdk = await a2aImport("@a2a-js/sdk");
       const express = await a2aImport("express");
       console.log("RESOLVED", typeof sdk, typeof (express.default ?? express));`],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.equal(resolveRun.status, 0, `${resolveRun.stderr} ${resolveRun.stdout}`);
    assert.match(resolveRun.stdout, /RESOLVED/, 'deps must resolve from the recorded package root');
    assert.doesNotMatch(resolveRun.stderr, /A2A SDK missing/);

    // `aos-a2a list/card` never touch the SDK (exit 0); `send` must fail to CONNECT, not with SDK missing.
    const launcher = path.join(home, '.agents', 'bin', 'aos-a2a.mjs');
    assert.ok(fs.existsSync(launcher), 'aos-a2a copy must exist');
    for (const args of [['status', '--to', 'x', 't1'], ['send', '--to', 'x', 'hi']]) {
      const run = spawnSync(process.execPath, [launcher, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
      const all = `${run.stdout}\n${run.stderr}`;
      assert.doesNotMatch(all, /A2A SDK missing/, `sdk-missing leak for ${args.join(' ')}: ${all}`);
    }
  });
});
