// OpenCode self-unlock: an agent that posts a prompt to the OpenCode server itself can forge a human `gogate off`/GO.
// Any non-GET network call to the server's own loopback port is guarded whatever the path or spelling.
const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

let g;
before(async () => {
    g = await import(pathToFileURL(path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs')).href);
    g.setGateContext({ cwd: process.cwd(), blockTs: 0 });
    g.setOpencodeServer('http://127.0.0.1:51234');
});

const GUARDED = [
    "curl -s http://127.0.0.1:4096/session/x/message -d '{}'", 'curl -X POST http://localhost:4096/anything', 'curl -s 127.0.0.1:409[6]/x -d a',
    'curl -d a 127.0.0.1:{4096,4097}/x', 'curl -d a http://127.0.0.1:$P/x', 'curl -d a http://$H:4096/x', 'curl -X POST http://127.0.0.1:51234/x',
    'curl -d a http://[::1]:4096/x', "curl -d a http://127.0.0.1:40'96'/x", 'wget --post-data=a http://0.0.0.0:4096/',
    `node -e "fetch('http://127.0.0.1:'+'4096'+'/x',{method:'POST'})"`, `python3 -c "import urllib.request as u;u.urlopen('http://localhost:4096/x',b'a')"`,
    'nc 127.0.0.1 4096', 'Invoke-RestMethod http://127.0.0.1:4096/x -Method POST', 'opencode run --attach http://localhost:4096 hi',
];
const FREE = ['curl -s http://127.0.0.1:4096/session', 'curl -s http://127.0.0.1:3000/api -d a', 'curl -s localhost:8080/health', 'npm test'];

test('writes and unresolvable calls to the OpenCode port are guarded, never grantable, never lifted by off', () => {
    for (const c of GUARDED) {
        assert.ok(g.isGuardedCommand(c), c);
        assert.equal(g.commandScopes(c), null, c);
        assert.ok(g.opencodeRoute(c), c);
    }
});

test('a plain GET and other loopback ports stay free', () => {
    for (const c of FREE) assert.equal(g.isGuardedCommand(c), false, c);
});
