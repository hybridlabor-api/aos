const { test } = require('node:test');
const assert = require('node:assert');
const { buildUserUnit, buildTimerUnit, unitPath, enableUnit, disableUnit } = require('../lib/systemd-units');

test('a server unit quotes every argument and restarts always', () => {
    const u = buildUserUnit({ description: 'memB WebUI', execStart: ['/opt/my "py"/python', '/a b/server.py'], workingDirectory: '/w', env: { A: '1' }, logOut: '/l/out.log', logErr: '/l/err.log' });
    assert.match(u, /^ExecStart="\/opt\/my \\"py\\"\/python" "\/a b\/server\.py"$/m);
    assert.match(u, /^Environment="A=1"$/m);
    assert.match(u, /^Restart=always$/m);
    assert.match(u, /^StandardOutput=append:\/l\/out\.log$/m);
    assert.match(u, /^WantedBy=default\.target$/m);
});

test('a timer unit points at its oneshot service', () => {
    const t = buildTimerUnit({ description: 'x', unit: 'a.service', onBootSec: '5min', onUnitActiveSec: '2h' });
    assert.match(t, /^Unit=a\.service$/m);
    assert.match(t, /^OnUnitActiveSec=2h$/m);
});

test('unit files live under ~/.config/systemd/user', () => {
    assert.strictEqual(unitPath('/h', 'a.service'), require('path').join('/h', '.config', 'systemd', 'user', 'a.service'));
});

test('enable reloads, then enables with --now; disable stops too', async () => {
    const calls = [];
    const run = async (cmd, args) => { calls.push([cmd, ...args]); return { ok: true }; };
    await enableUnit(run, 'a.service');
    await disableUnit(run, 'a.service');
    assert.deepStrictEqual(calls, [
        ['systemctl', '--user', 'daemon-reload'],
        ['systemctl', '--user', 'enable', '--now', 'a.service'],
        ['systemctl', '--user', 'disable', '--now', 'a.service'],
    ]);
});
