import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const doctorScript = path.join(__dirname, '..', 'skills', 'global_config', 'aos-project-init', 'scripts', 'aos-project-doctor.mjs');

function setupTempEnv() {
  const tmpHome = mkdtempSync(path.join(os.tmpdir(), 'aos-home-'));
  const tmpWorkspace = mkdtempSync(path.join(os.tmpdir(), 'aos-ws-'));

  // Create 3 siblings in workspace to trigger checkWorkspace
  mkdirSync(path.join(tmpWorkspace, 'proj1'));
  mkdirSync(path.join(tmpWorkspace, 'proj2'));
  mkdirSync(path.join(tmpWorkspace, 'proj3'));

  const root = path.join(tmpWorkspace, 'proj1');

  // Setup .aos/project.json
  mkdirSync(path.join(root, '.aos'));
  writeFileSync(path.join(root, '.aos', 'project.json'), JSON.stringify({ slug: 'test-proj' }));

  // Setup machine config
  mkdirSync(path.join(tmpHome, '.agents'));
  writeFileSync(path.join(tmpHome, '.agents', 'aos-config.json'), JSON.stringify({
    workspaceRoot: tmpWorkspace,
    domains: ['test'],
    userId: 'user1'
  }));

  return { tmpHome, tmpWorkspace, root };
}

test('aos-project-doctor: OpenWiki initialized, watched, memB advice, WORKSPACE suggestion', async () => {
  const { tmpHome, tmpWorkspace, root } = setupTempEnv();

  try {
    // Setup OpenWiki (initialized, not watched)
    mkdirSync(path.join(root, '.openwiki'));
    writeFileSync(path.join(root, '.openwiki', 'page1.md'), 'test');

    // Setup memB (db exists but no memories)
    mkdirSync(path.join(tmpHome, '.MemBDB'));
    // Since sqlite module will try to open it, create a valid empty db or mock it.
    // Alternatively we can use node:sqlite to create an empty table.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(tmpHome, '.MemBDB', 'memb.db'));
    db.exec('CREATE TABLE memb_vectors (payload TEXT);');
    db.close();

    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [doctorScript, root, '--json'], {
        env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
        encoding: 'utf8'
      });
    } catch (err) {
      stdout = err.stdout;
    }

    const data = JSON.parse(stdout);

    // Find rows
    const wikiInitRow = data.results.find(r => r.area === 'openwiki' && r.name === 'OpenWiki initialized');
    assert.ok(wikiInitRow);
    assert.equal(wikiInitRow.ok, true);
    assert.match(wikiInitRow.detail, /openwiki\/ present/);

    const wikiWatchedRow = data.results.find(r => r.area === 'openwiki' && r.name === 'watched');
    assert.ok(wikiWatchedRow);
    assert.equal(wikiWatchedRow.ok, false);

    const membRow = data.results.find(r => r.area === 'memB' && r.name === 'entries for the project slug');
    assert.ok(membRow);
    assert.equal(membRow.ok, false); // 0 memories is false in original script logic
    assert.match(membRow.detail, /advice to ingest/);

    const workspaceRow = data.results.find(r => r.area === 'workspace' && r.name === 'WORKSPACE.md map');
    assert.ok(workspaceRow);
    assert.equal(workspaceRow.ok, true); // It's a suggestion, so it shouldn't fail
    assert.match(workspaceRow.detail, /has 3 items but no WORKSPACE.md map/);

  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});
