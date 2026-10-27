'use strict';
// One console line per step; everything the step prints or spawns goes to the log file.
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { spawnSync } = require('child_process');
const cliSpawn = require('../cli-spawn');

const logFileFor = (home, now = new Date()) => path.join(home, '.aos', 'logs', `update-${now.toISOString().replace(/[:.]/g, '-')}.log`);

// Track step timings globally for the final summary.
let _stepTimings = [];
const resetStepTimings = () => { _stepTimings = []; };
const getStepTimings = () => _stepTimings.slice();
const formatSlowestSteps = (timings, maxCount = 3) => {
    const sorted = timings.slice().sort((a, b) => b.ms - a.ms);
    const top = sorted.slice(0, maxCount);
    return top.map((t) => `${t.label} ${(t.ms / 1000).toFixed(1)}s`).join(', ');
};

// fn(run) may return a detail string. run(cmd, args, opts) throws on a non-zero exit unless opts.soft.
async function step(label, fn, { logFile, out = process.stdout.write.bind(process.stdout), run: runOverride }) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(logFile, 'a', 0o600);
    fs.writeSync(fd, `\n=== ${label} ===\n`);
    const defaultRun = (cmd, args = [], opts = {}) => {
        // A test sandbox never touches the network or the global npm prefix; tests that care inject `run`.
        if (process.env.AOS_TEST_SANDBOX === '1' && /^npm(\.cmd)?$/i.test(cmd) && args.includes('-g')) return { status: 0, stdout: '', stderr: '' };
        const { soft, shell: _shell, ...spawnOpts } = opts;
        // Windows: npm/npx are .cmd shims; a bare spawnSync('npm') is ENOENT (Lenovo P15, gateway step).
        let inv = { file: cmd, args, options: {} };
        if (process.platform === 'win32') {
            const env = spawnOpts.env || process.env;
            const file = cliSpawn.resolveCommand(cmd, { env });
            if (file) inv = cliSpawn.buildInvocation(file, args, { env });
        }
        // stderr is piped (not given the log fd directly) so its last line can name the failure on the console.
        const r = spawnSync(inv.file, inv.args, { ...spawnOpts, ...(inv.options || {}), encoding: 'utf8', stdio: ['ignore', fd, 'pipe'], windowsHide: true });
        const errText = String(r.stderr || '');
        if (errText) fs.writeSync(fd, errText);
        if (!soft && (r.error || r.status !== 0)) {
            const lines = errText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const reason = lines.find((l) => /^npm (error|ERR!)/i.test(l) && !/^npm (error|ERR!) (A complete log|code\b)/i.test(l)) || lines[lines.length - 1] || (r.error && r.error.message) || '';
            throw new Error(`${cmd} ${args.join(' ')} failed (${r.error ? r.error.code : r.status})${reason ? `: ${reason.slice(0, 200)}` : ''}`);
        }
        return r;
    };
    const run = runOverride || defaultRun;
    const o = process.stdout.write;
    const e = process.stderr.write;
    const sink = (chunk, enc, cb) => { try { fs.writeSync(fd, typeof chunk === 'string' ? chunk : Buffer.from(chunk)); } catch { /* log is best effort */ } if (typeof enc === 'function') enc(); else if (cb) cb(); return true; };
    process.stdout.write = sink;
    process.stderr.write = sink;
    const prevNI = process.env.AOS_NONINTERACTIVE;
    process.env.AOS_NONINTERACTIVE = '1';
    const startTime = performance.now();
    let result;
    try {
        const detail = await fn(run);
        result = { ok: true, detail: detail ? String(detail) : '' };
    } catch (err) {
        fs.writeSync(fd, `${err && err.stack || err}\n`);
        result = { ok: false, detail: '', error: err };
    } finally {
        const endTime = performance.now();
        const ms = endTime - startTime;
        _stepTimings.push({ label, ms });
        fs.writeSync(fd, `\n[timing] ${label}: ${(ms / 1000).toFixed(1)}s\n`);
        if (prevNI === undefined) delete process.env.AOS_NONINTERACTIVE; else process.env.AOS_NONINTERACTIVE = prevNI;
        process.stdout.write = o;
        process.stderr.write = e;
        fs.closeSync(fd);
    }
    out(result.ok ? `✔ ${label}${result.detail ? ` ${result.detail}` : ''}\n` : `✖ ${label} — see ${logFile}\n`);
    return result;
}

module.exports = { step, logFileFor, resetStepTimings, getStepTimings, formatSlowestSteps };
