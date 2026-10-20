'use strict';
// Service-manager helpers shared by the gateway and hub packages. A command runs through ctx.serviceRunner or
// ctx.run; inside a test sandbox it is a no-op. "failed" covers a rejected run and a failing status alike.
const { spawnSync } = require('child_process');
const profile = require('./profile');
const { winBin } = require('../win-bin');

const failed = (r) => !!r && typeof r === 'object' && (r.ok === false || r.status > 0 || r.code > 0 || !!r.error);
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const uidOf = (ctx) => (ctx.uid !== undefined ? ctx.uid : process.getuid());
const sayOf = (ctx) => (typeof ctx.log === 'function' ? ctx.log : ctx.log && ctx.log.step ? (m) => ctx.log.step(m) : () => {});

// Null on success, otherwise the failure line for the user.
async function svc(ctx, bin, args) {
    bin = winBin(bin);
    if (ctx && ctx.serviceRunner) {
        try {
            const runner = typeof ctx.serviceRunner === 'function' ? ctx.serviceRunner : ctx.run;
            const r = await runner(bin, args);
            if (!failed(r)) return null;
            return `${bin} failed: ${String(r.stderr || (r.error && r.error.message) || r.error || '').trim().split('\n')[0] || 'no output'}`;
        } catch (e) { return `${bin} failed: ${e.message}`; }
    }
    if (profile.isTestSandbox(ctx && ctx.home)) return null;
    try {
        const r = await ctx.run(bin, args);
        if (!failed(r)) return null;
        return `${bin} failed: ${String(r.stderr || (r.error && r.error.message) || r.error || '').trim().split('\n')[0] || 'no output'}`;
    } catch (e) { return `${bin} failed: ${e.message}`; }
}
const systemctl = (ctx, args) => svc(ctx, 'systemctl', ['--user', ...args]);
const schtasks = (ctx, args) => svc(ctx, 'schtasks', args);
// Legacy scheduled task cleanup: query first, so an absent task never produces schtasks' "cannot find the file" error.
// ctx.taskExists(name) is the test seam; tests with a serviceRunner or a sandbox home keep the plain call sequence.
async function legacyTask(ctx, name, args) {
    const exists = ctx && typeof ctx.taskExists === 'function' ? ctx.taskExists
        : ctx && !ctx.serviceRunner && !profile.isTestSandbox(ctx.home)
            ? (n) => spawnSync('schtasks', ['/Query', '/TN', n], { stdio: 'ignore', windowsHide: true, timeout: 10000 }).status === 0
            : null;
    if (exists && !(await exists(name))) return null;
    return schtasks(ctx, args);
}
async function launchctl(ctx, args) {
    if (ctx && ctx.serviceRunner) {
        try {
            const runner = typeof ctx.serviceRunner === 'function' ? ctx.serviceRunner : ctx.run;
            return !failed(await runner('launchctl', args));
        } catch { return false; }
    }
    if (profile.isTestSandbox(ctx && ctx.home)) return true;
    try { return !failed(await ctx.run('launchctl', args)); } catch { return false; }
}

// True when `text` (unit, plist or .vbs) launches <...>/bin/<script> as a whole argument, not as a substring of another name.
const runsScript = (text, script) => new RegExp(`(?:^|["'>=\\s])[^"'<>\\r\\n]*[\\\\/]bin[\\\\/]${script.replace(/\./g, '\\.')}(?=["'<\\s]|$)`).test(String(text));

module.exports = { runsScript, failed, xml, uidOf, sayOf, svc, systemctl, schtasks, legacyTask, launchctl };
