'use strict';
// Windows only: a running service holds its module directory, so the swap to a new version fails with EPERM/EBUSY.
// Stops exactly the processes whose command line or image path points into that directory; the module step starts its service again.
const path = require('path');
const { execFileSync } = require('child_process');

// Modules that run a long-lived service from their own directory (by directory name): add a module here to give it the stop.
// MCP copies (memb-mcp, creator MCPs) are left out on purpose: they are stdio servers of live sessions, and stopping them
// would cut those sessions' tools, so a locked MCP copy keeps the plain "locked" message.
const SERVICE_MODULES = new Set(['memb', 'bdb-synapse']);
const isServiceModule = (dir) => SERVICE_MODULES.has(path.win32.basename(String(dir)).toLowerCase());

const norm = (s) => String(s || '').replace(/\//g, '\\').toLowerCase();
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function listProcesses() {
    const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 20000 });
    const rows = JSON.parse(out);
    return Array.isArray(rows) ? rows : [rows];
}

const killTree = (pid) => execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });

// The directory must stand on its own: memB must not match memB2 or xmemB.
function pointsInto(text, dirN) {
    const t = norm(text);
    for (let i = t.indexOf(dirN); i !== -1; i = t.indexOf(dirN, i + 1)) {
        const before = t[i - 1];
        const after = t[i + dirN.length];
        const startsClean = before === undefined || /[\s"'=]/.test(before);
        const endsClean = after === undefined || after === '\\' || /[\s"']/.test(after);
        if (startsClean && endsClean) return true;
    }
    return false;
}

function findModuleProcesses(dir, procs, { selfPid = process.pid } = {}) {
    const dirN = norm(dir).replace(/\\+$/, '');
    if (!dirN) return [];
    const parent = new Map(procs.map((p) => [p.ProcessId, p.ParentProcessId]));
    const protectedPids = new Set();
    for (let pid = selfPid; pid && !protectedPids.has(pid); pid = parent.get(pid)) protectedPids.add(pid);
    return procs.filter((p) => !protectedPids.has(p.ProcessId) && (pointsInto(p.CommandLine, dirN) || pointsInto(p.ExecutablePath, dirN)));
}

// Returns the stopped processes; [] when nothing matched, the platform is not Windows, or AOS_NO_STOP_SERVICES=1.
function stopModuleProcesses(dir, { platform = process.platform, env = process.env, list = listProcesses, kill = killTree, sleep = sleepSync, selfPid = process.pid } = {}) {
    if (platform !== 'win32' || env.AOS_NO_STOP_SERVICES === '1') return [];
    let procs;
    try { procs = list(); } catch { return []; }
    const found = findModuleProcesses(dir, procs, { selfPid });
    const stopped = [];
    for (const p of found) {
        try { kill(p.ProcessId); stopped.push(p); } catch { /* already gone, or a child killed with its parent */ }
    }
    if (stopped.length) sleep(500);
    return stopped;
}

module.exports = { stopModuleProcesses, findModuleProcesses, pointsInto, isServiceModule, SERVICE_MODULES };
