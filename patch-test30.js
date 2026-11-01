const fs = require('fs');
let code = fs.readFileSync('tests/mcp-pick.test.js', 'utf8');

code = code.replace(
    /test\('resolume detected: official kept with command replaced, ours retired', \(\) => \{/,
    `test('resolume detected (>= 7.26.0): official kept with command replaced, ours retired', () => {`
);

code = code.replace(
    /const detect = \(app\) => \(app === 'resolume' \? \{ path: '\/opt\/arena\/mcp\/resolume_arena_mcp_server' \} : null\);/,
    `const detect = (app) => (app === 'resolume' ? { version: '7.26.1', path: '/opt/arena/mcp/resolume_arena_mcp_server' } : null);`
);

code = code.replace(
    /test\('resolume placeholder without path: not satisfied, ours stays', \(\) => \{/,
    `test('resolume detected (< 7.26.0): ours kept, official retired', () => {
        const detect = (app) => (app === 'resolume' ? { version: '7.25.0', path: '/opt/arena/mcp/resolume_arena_mcp_server' } : null);
        const r = applyPicks(servers, picks, detect);
        assert.ok(r.servers.bdb_resolume_mcp);
        assert.ok(!r.servers.bdb_resolume_official_mcp);
        assert.deepEqual(r.retired.sort(), ['bdb_blender_official_mcp', 'bdb_resolume_official_mcp']);
    });
    test('resolume placeholder without path: not satisfied, ours stays', () => {`
);

code = code.replace(
    /const detect = \(app\) => \(app === 'blender' \? \{ version: '5\.1' \} : app === 'resolume' \? \{ path: '\/x' \} : null\);/,
    `const detect = (app) => (app === 'blender' ? { version: '5.1' } : app === 'resolume' ? { path: '/x', version: '7.26.0' } : null);`
);

fs.writeFileSync('tests/mcp-pick.test.js', code);
