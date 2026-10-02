'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER_RE = /^##\s+.+?\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$/gim;
const BUILDER_FILE = 'plan.builder.html';
const PLAN_REL = path.join('production_artifacts', '00_execution_plan.md');
const KILL_AFTER_MS = 10000;

function planComponents(file) {
  try {
    if (/\.(md|markdown)$/i.test(file)) {
      const text = fs.readFileSync(file, 'utf8');
      return [...text.matchAll(MARKER_RE)].map((m) => m[1]);
    }
    if (path.basename(file) === BUILDER_FILE) {
      const { derive } = require('../plan-builder/trail');
      return derive(path.dirname(file)).graph.map((c) => c.id);
    }
  } catch {
    // unreadable or unparsable plan: no components
  }
  return [];
}

function repoRoot(dir, spawnSyncImpl) {
  try {
    const r = spawnSyncImpl('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir, shell: false, timeout: 1000, encoding: 'utf8'
    });
    const out = r && r.status === 0 ? String(r.stdout || '').trim() : '';
    return out || dir;
  } catch {
    return dir;
  }
}

function resolveBinary(env) {
  if (env.AOS_PLAN_CANVAS_TRAIL_BIN) return { cmd: env.AOS_PLAN_CANVAS_TRAIL_BIN, pre: [] };
  const script = path.resolve(__dirname, '../../../../agenttrail/bin/agenttrail.mjs');
  if (fs.existsSync(script)) return { cmd: process.execPath, pre: [script] };
  if (process.platform !== 'win32') return { cmd: 'aos-trail', pre: [] };
  return null;
}

function builderPlan(dir, repo) {
  const target = path.join(repo, PLAN_REL);
  if (fs.existsSync(target)) return target;
  try {
    const { writeTrail } = require('../plan-builder/trail');
    writeTrail(dir, { workspaceRoot: repo });
    return target;
  } catch {
    return null;
  }
}

function ensureTrailOnApprove({ file, key, log = () => {}, spawnImpl = childProcess.spawn, env = process.env, spawnSyncImpl = childProcess.spawnSync } = {}) {
  try {
    if (env.AOS_PLAN_CANVAS_TRAIL === 'off') return;
    if (!planComponents(file).length) return;
    const dir = path.dirname(file);
    const repo = repoRoot(dir, spawnSyncImpl);
    const plan = path.basename(file) === BUILDER_FILE ? builderPlan(dir, repo) : file;
    const bin = resolveBinary(env);
    if (!bin) return log('[plan-canvas] trail: agenttrail not installed');

    const args = [...bin.pre, '--ensure', '--cwd', repo, ...(plan ? ['--plan', plan] : []), '--session', `plan-canvas-${key}`, '--json'];
    const stateDir = env.AOS_PLAN_CANVAS_STATE_DIR || path.join(os.homedir(), '.claude', 'aos-plan-canvas');
    fs.mkdirSync(stateDir, { recursive: true });
    const fd = fs.openSync(path.join(stateDir, 'server.log'), 'a');
    let child;
    try {
      child = spawnImpl(bin.cmd, args, { shell: false, detached: true, stdio: ['ignore', fd, fd], env });
    } finally {
      fs.closeSync(fd);
    }
    if (!child) return;
    if (typeof child.on === 'function') child.on('error', (e) => log(`[plan-canvas] trail: ${e.message}`));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, KILL_AFTER_MS);
    if (timer.unref) timer.unref();
    if (typeof child.once === 'function') child.once('exit', () => clearTimeout(timer));
    if (typeof child.unref === 'function') child.unref();
  } catch (e) {
    try { log(`[plan-canvas] trail: ${e && e.message}`); } catch { /* logging must not throw */ }
  }
}

module.exports = { planComponents, ensureTrailOnApprove };
