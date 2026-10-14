const { test } = require('node:test');
const assert = require('node:assert');
const { stopModuleProcesses, findModuleProcesses, pointsInto, isServiceModule } = require('../lib/stop-module-processes.js');

test('only the service modules get the stop, MCP copies keep the plain locked message', () => {
    assert.ok(isServiceModule('C:\\Users\\Yola\\.agents\\memB'));
    assert.ok(isServiceModule('C:\\Users\\Yola\\.agents\\bdb-synapse\\'.replace(/\\$/, '')));
    assert.ok(!isServiceModule('C:\\Users\\Yola\\.gemini\\config\\mcps\\memb-mcp'));
    assert.ok(!isServiceModule('C:\\Users\\Yola\\.agents\\bdb-dev-creator-extension'));
});

const DIR = 'C:\\Users\\Yola\\.agents\\memB';
const proc = (ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath = null) => ({ ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath });

const table = () => [
    proc(1, 0, 'System', null),
    proc(100, 1, 'node.exe', 'node C:\\npx\\aos\\installer.js'),
    proc(200, 100, 'python.exe', '"C:\\Users\\Yola\\.agents\\memB\\.venv\\Scripts\\python.exe" "C:\\Users\\Yola\\.agents\\memB\\src\\backend\\server.py"', 'C:\\Users\\Yola\\.agents\\memB\\.venv\\Scripts\\python.exe'),
    proc(201, 200, 'python.exe', 'C:\\uv\\python.exe C:/Users/Yola/.agents/memB/src/backend/server.py'),
    proc(300, 1, 'synapse.exe', 'C:\\Users\\Yola\\.agents\\bdb-synapse\\bin\\synapse.exe', 'C:\\Users\\Yola\\.agents\\bdb-synapse\\bin\\synapse.exe'),
    proc(400, 1, 'python.exe', 'python C:\\Users\\Yola\\.agents\\memB2\\server.py'),
    proc(401, 1, 'python.exe', 'python C:\\Users\\Yola\\.agents\\xmemB\\server.py'),
    proc(402, 1, 'notepad.exe', 'notepad C:\\Users\\Yola\\.agents\\memB-notes.txt'),
];

test('pointsInto matches the directory on its own, either slash style and any case', () => {
    const d = 'c:\\users\\yola\\.agents\\memb';
    assert.ok(pointsInto('"C:\\Users\\Yola\\.agents\\memB\\src\\x.py"', d));
    assert.ok(pointsInto('python C:/USERS/yola/.agents/memB/src/x.py', d));
    assert.ok(pointsInto('python "C:\\Users\\Yola\\.agents\\memB"', d));
    assert.ok(!pointsInto('python C:\\Users\\Yola\\.agents\\memB2\\x.py', d));
    assert.ok(!pointsInto('python C:\\Users\\Yola\\.agents\\xmemB\\x.py', d));
    assert.ok(!pointsInto('notepad C:\\Users\\Yola\\.agents\\memB-notes.txt', d));
    assert.ok(!pointsInto(null, d));
});

test('findModuleProcesses selects the service tree and nothing else', () => {
    const pids = findModuleProcesses(DIR, table(), { selfPid: 100 }).map((p) => p.ProcessId);
    assert.deepStrictEqual(pids, [200, 201]);
});

test('findModuleProcesses never selects the installer itself or its ancestors', () => {
    const procs = table();
    procs[1] = proc(100, 50, 'node.exe', 'node C:\\Users\\Yola\\.agents\\memB\\run.js');
    procs.push(proc(50, 1, 'cmd.exe', 'cmd /c C:\\Users\\Yola\\.agents\\memB\\start.cmd'));
    const pids = findModuleProcesses(DIR, procs, { selfPid: 100 }).map((p) => p.ProcessId);
    assert.ok(!pids.includes(100) && !pids.includes(50));
    assert.deepStrictEqual(pids, [200, 201]);
});

test('stopModuleProcesses kills the matches, tolerates a failed kill and waits once', () => {
    const killed = []; let sleeps = 0;
    const out = stopModuleProcesses(DIR, {
        platform: 'win32', env: {}, selfPid: 100, list: table, listHolders: () => [], sleep: () => { sleeps++; },
        kill: (pid) => { killed.push(pid); if (pid === 201) throw new Error('already gone'); },
    });
    assert.deepStrictEqual(killed, [200, 201]);
    assert.deepStrictEqual(out.map((p) => p.ProcessId), [200]);
    assert.strictEqual(sleeps, 1);
});

test('stopModuleProcesses does nothing off Windows, with the opt-out, or when listing fails', () => {
    const kill = () => { throw new Error('must not kill'); };
    assert.deepStrictEqual(stopModuleProcesses(DIR, { platform: 'linux', env: {}, list: table, kill }), []);
    assert.deepStrictEqual(stopModuleProcesses(DIR, { platform: 'win32', env: { AOS_NO_STOP_SERVICES: '1' }, list: table, kill }), []);
    assert.deepStrictEqual(stopModuleProcesses(DIR, { platform: 'win32', env: {}, list: () => { throw new Error('no powershell'); }, kill }), []);
});

test('stopModuleProcesses returns [] and sleeps not at all when nothing matches', () => {
    let sleeps = 0;
    const out = stopModuleProcesses('C:\\Users\\Yola\\.agents\\other', { platform: 'win32', env: {}, selfPid: 100, list: table, listHolders: () => [], kill: () => {}, sleep: () => { sleeps++; } });
    assert.deepStrictEqual(out, []);
    assert.strictEqual(sleeps, 0);
});

// uvicorn --reload leaves a multiprocessing worker whose command line has no module path, but which maps the venv's .pyd files.
test('stopModuleProcesses also stops an orphaned worker found only by its mapped modules', () => {
    const killed = []; let sleeps = 0;
    const orphan = { ProcessId: 900, Name: 'python' };
    const out = stopModuleProcesses(DIR, {
        platform: 'win32', env: {}, selfPid: 100, list: table, listHolders: () => [orphan, { ProcessId: 200, Name: 'python' }],
        sleep: () => { sleeps++; }, kill: (pid) => killed.push(pid),
    });
    assert.deepStrictEqual(killed, [200, 201, 900]);
    assert.deepStrictEqual(out.map((p) => p.ProcessId), [200, 201, 900]);
    assert.strictEqual(sleeps, 2);
});

test('the module scan never kills the installer or its ancestors, and a failing scan keeps the first pass', () => {
    const killed = [];
    const out = stopModuleProcesses(DIR, {
        platform: 'win32', env: {}, selfPid: 100, list: table, sleep: () => {}, kill: (pid) => killed.push(pid),
        listHolders: () => [{ ProcessId: 100, Name: 'node' }, { ProcessId: 1, Name: 'System' }],
    });
    assert.deepStrictEqual(killed, [200, 201]);
    assert.deepStrictEqual(out.map((p) => p.ProcessId), [200, 201]);
    const out2 = stopModuleProcesses(DIR, { platform: 'win32', env: {}, selfPid: 100, list: table, sleep: () => {}, kill: () => {}, listHolders: () => { throw new Error('scan failed'); } });
    assert.deepStrictEqual(out2.map((p) => p.ProcessId), [200, 201]);
});
