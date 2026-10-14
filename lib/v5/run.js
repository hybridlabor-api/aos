'use strict';
// One console line per step; everything the step prints or spawns goes to the log file.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const cliSpawn = require('../cli-spawn');

const logFileFor = (home, now = new Date()) => path.join(home, '.aos', 'logs', `update-${now.toISOString().replace(/[:.]/g, '-')}.log`);

// fn(run) may return a detail string. run(cmd, args, opts) throws on a non-zero exit unless opts.soft.
async function step(label, fn, { logFile, out = process.stdout.write.bind(process.stdout) }) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(logFile, 'a', 0o600);
    fs.writeSync(fd, `\n=== ${label} ===\n`);
    const run = (cmd, args = [], opts = {}) => {
        const { soft, ...spawnOpts } = opts;
        // Windows: npm/npx are .cmd shims; a bare spawnSync('npm') is ENOENT (Lenovo P15, gateway step).
        let inv = { file: cmd, args, options: {} };
        if (process.platform === 'win32') {
            const env = spawnOpts.env || process.env;
            const file = cliSpawn.resolveCommand(cmd, { env });
            if (file) inv = cliSpawn.buildInvocation(file, args, { env });
        }
        const r = spawnSync(inv.file, inv.args, { ...spawnOpts, ...(inv.options || {}), stdio: ['ignore', fd, fd], windowsHide: true });
        if (!soft && (r.error || r.status !== 0)) throw new Error(`${cmd} ${args.join(' ')} failed (${r.error ? r.error.code : r.status})`);
        return r;
    };
    const o = process.stdout.write;
    const e = process.stderr.write;
    const sink = (chunk, enc, cb) => { try { fs.writeSync(fd, typeof chunk === 'string' ? chunk : Buffer.from(chunk)); } catch { /* log is best effort */ } if (typeof enc === 'function') enc(); else if (cb) cb(); return true; };
    process.stdout.write = sink;
    process.stderr.write = sink;
    const prevNI = process.env.AOS_NONINTERACTIVE;
    process.env.AOS_NONINTERACTIVE = '1';
    let result;
    try {
        const detail = await fn(run);
        result = { ok: true, detail: detail ? String(detail) : '' };
    } catch (err) {
        fs.writeSync(fd, `${err && err.stack || err}\n`);
        result = { ok: false, detail: '', error: err };
    } finally {
        if (prevNI === undefined) delete process.env.AOS_NONINTERACTIVE; else process.env.AOS_NONINTERACTIVE = prevNI;
        process.stdout.write = o;
        process.stderr.write = e;
        fs.closeSync(fd);
    }
    out(result.ok ? `✔ ${label}${result.detail ? ` ${result.detail}` : ''}\n` : `✖ ${label} — see ${logFile}\n`);
    return result;
}

module.exports = { step, logFileFor };
