import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePs, parseWindows, cpuMsOf, evaluate, runResources, format } from '../lib/resources.mjs';

const MAC = `  1     0   9000   0:05.10 /sbin/launchd
 100     1  40000   0:30.00 /opt/homebrew/bin/node /Users/t/.agents/bin/aos-gateway.mjs serve
 101   100  30000   1:02.50 node /Users/t/.agents/gateway/node_modules/@1mcp/agent/build/index.js serve
 102     1  35000   0:10.00 node /Users/t/.agents/skills/plan-canvas/scripts/plan-canvas.js server
 103     1  30000   0:12.00 node /Users/t/.agents/skills/agenttrail/bin/agenttrail.mjs /repo --no-open
 104   101  30000   0:02.00 node /Users/t/.gemini/config/mcps/unreal_mcp/dist/cli.js
 105   101  20000   0:01.00 node /Users/t/.agents/bin/aos-mcp-env.mjs --vars X -- node /Users/t/.agents/gateway/mcp-pkgs/node_modules/s/index.js
 900     1  80000  10:00.00 /usr/bin/claude
 901     1  20000   0:01.00 node /Users/t/.agents/bin/aos-a2a.mjs serve --name claude-a --harness claude --mode live --parent-pid 900
`;
const LINUX = `    1     0  9000 00:00:05 /sbin/init
  200     1 40000 1-02:03:04 node /home/t/.agents/bin/aos-gateway.mjs serve
  201   200 30000 00:01:02 node /home/t/.agents/gateway/node_modules/@1mcp/agent/build/index.js serve
  300     1 12000 00:00:01 node /home/t/.agents/bin/aos-a2a.mjs serve --name claude-b --harness claude --mode live --parent-pid 4242
`;
const WIN = JSON.stringify([
  { ProcessId: 4, ParentProcessId: 0, WorkingSetSize: 100, KernelModeTime: 1, UserModeTime: 1, CommandLine: null },
  { ProcessId: 500, ParentProcessId: 1, WorkingSetSize: 41943040, KernelModeTime: 20000000, UserModeTime: 10000000, CommandLine: 'C:\\node\\node.exe C:\\Users\\t\\.agents\\bin\\aos-gateway.mjs serve' },
  { ProcessId: 501, ParentProcessId: 500, WorkingSetSize: 31457280, KernelModeTime: 0, UserModeTime: 5000000, CommandLine: 'node C:\\Users\\t\\.gemini\\config\\mcps\\unreal_mcp\\dist\\cli.js' },
  { ProcessId: 502, ParentProcessId: 7777, WorkingSetSize: 20971520, KernelModeTime: 0, UserModeTime: 0, CommandLine: 'node C:\\Users\\t\\.gemini\\config\\mcps\\adobe_uxp_mcp\\index.js' },
]);

test('cpuMsOf reads macOS, Linux and day-prefixed times', () => {
  assert.equal(cpuMsOf('0:05.10'), 5100);
  assert.equal(cpuMsOf('00:01:02'), 62000);
  assert.equal(cpuMsOf('1-02:03:04'), (86400 + 7384) * 1000);
});

test('parsePs: macOS and Linux fixtures', () => {
  const mac = parsePs(MAC);
  assert.equal(mac.length, 9);
  assert.deepEqual(mac[1], { pid: 100, ppid: 1, rssKb: 40000, cpuMs: 30000, command: '/opt/homebrew/bin/node /Users/t/.agents/bin/aos-gateway.mjs serve' });
  const lin = parsePs(LINUX);
  assert.equal(lin.length, 4);
  assert.equal(lin[1].cpuMs, (86400 + 7384) * 1000);
});

test('parseWindows: CIM JSON, units converted, null command line tolerated, single object accepted', () => {
  const w = parseWindows(WIN);
  assert.equal(w.length, 4);
  const gw = w.find((p) => p.pid === 500);
  assert.equal(gw.rssKb, 40960);
  assert.equal(gw.cpuMs, 3000);
  assert.equal(parseWindows(JSON.stringify({ ProcessId: 9, ParentProcessId: 1, WorkingSetSize: 1024, KernelModeTime: 0, UserModeTime: 0, CommandLine: 'x' })).length, 1);
  assert.deepEqual(parseWindows('not json'), []);
});

const by = (checks, name) => checks.find((c) => c.name === name);

test('evaluate: a healthy idle macOS machine passes every check', () => {
  const procs = parsePs(MAC);
  const { checks, summary } = evaluate({ procs, selfPids: [], after: procs, wallMs: 10000 });
  assert.deepEqual(checks.map((c) => c.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
  assert.equal(summary.processes, 7, 'claude itself (pid 900) is not AOS-owned');
  assert.equal(by(checks, 'Idle CPU').detail.startsWith('0.0%'), true);
});

test('evaluate: sidecar whose parent is gone, stray worktree server and unowned leaf under an owned wrapper', () => {
  const procs = [
    ...parsePs(LINUX),
    ...parsePs(' 310     1  9000 00:00:01 node /Users/t/dev/aos-wt-x/skills/global_config/agenttrail/bin/agenttrail.mjs /tmp/r --no-open\n 320   201  9000 00:00:01 /usr/bin/mcp-server-leaf'),
  ];
  const { checks } = evaluate({ procs });
  const orphans = by(checks, 'Orphans');
  assert.equal(orphans.status, 'WARN');
  assert.match(orphans.detail, /300 \(a2a sidecar, parent 4242 is gone\)/);
  assert.match(orphans.detail, /310 \(server started from a worktree\/temp dir/);
  assert.doesNotMatch(orphans.detail, /320/, 'a child of a live owned process is not an orphan');
  assert.equal(by(checks, 'AOS processes').detail, '5', 'leaf 320 counts through its owned ancestor');
});

test('evaluate: duplicate MCP servers and two sidecars of one parent', () => {
  const procs = parsePs(`  1 0 1 0:00.00 /sbin/launchd
 10 1 20000 0:01.00 node /Users/t/.gemini/config/mcps/unreal_mcp/dist/cli.js
 11 1 20000 0:01.00 node /Users/t/.gemini/config/mcps/unreal_mcp/dist/cli.js
 12 1 5000 0:01.00 node /Users/t/.agents/bin/aos-a2a.mjs serve --name a --harness claude --parent-pid 900
 13 1 5000 0:01.00 node /Users/t/.agents/bin/aos-a2a.mjs serve --name b --harness claude --parent-pid 900
 900 1 5000 0:01.00 /usr/bin/claude`);
  const d = by(evaluate({ procs }).checks, 'Duplicate MCP servers');
  assert.equal(d.status, 'WARN');
  assert.match(d.detail, /2x node \/users\/t\/\.gemini\/config\/mcps\/unreal_mcp/);
  assert.match(d.detail, /2 a2a sidecars for parent 900/);
});

test('evaluate: Windows fixture flags the server whose parent vanished; CPU is the delta between snapshots', () => {
  const before = parseWindows(WIN);
  const after = before.map((p) => (p.pid === 500 ? { ...p, cpuMs: p.cpuMs + 1000 } : p));
  const { checks } = evaluate({ procs: before, after, wallMs: 10000 });
  assert.match(by(checks, 'Orphans').detail, /502 \(parent process is gone\)/);
  const cpu = by(checks, 'Idle CPU');
  assert.equal(cpu.status, 'WARN');
  assert.match(cpu.detail, /^10\.0%/);
});

test('legacy agy template in HOME is reported', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'res-home-'));
  mkdirSync(join(home, '.agents'));
  writeFileSync(join(home, '.agents', 'mcp_config.json'), JSON.stringify({ mcpServers: { a: {}, b: {} } }));
  assert.equal(by(evaluate({ procs: [], home }).checks, 'Legacy agy MCP template').status, 'WARN');
  assert.equal(by(evaluate({ procs: [], home: mkdtempSync(join(tmpdir(), 'res-home-')) }).checks, 'Legacy agy MCP template'), undefined);
});

test('runResources picks ps or PowerShell per platform and samples twice', async () => {
  for (const [platform, out, cmd] of [['darwin', MAC, 'ps'], ['linux', LINUX, 'ps'], ['win32', WIN, 'powershell.exe']]) {
    const calls = [];
    let t = 0;
    const r = await runResources({ sampleSec: 10, platform, run: (c) => { calls.push(c); return out; }, sleep: async () => { t += 10000; }, now: () => t });
    assert.deepEqual(calls, [cmd, cmd]);
    assert.ok(by(r.checks, 'Idle CPU'));
    assert.match(format(r), /^(PASS|WARN)  AOS processes: /);
  }
});
