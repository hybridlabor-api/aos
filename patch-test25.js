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
    /test\('resolume darwin: path when bundled server exists', \(\) => \{([\s\S]*?)test\('resolume win32 with default ProgramFiles and env override', \(\) => \{([\s\S]*?)test\('fs errors -> null, never throws'/m,
    `test('resolume darwin: path when bundled server exists', () => {
        const f = {
            existsSync: (p) => String(p) === '/Applications/Resolume Arena/mcp/resolume_arena_mcp_server',
            readdirSync: () => { throw new Error('n/a'); },
            readFileSync: (p) => {
                if (String(p).includes('default.xml')) return '<version="7.26.0">';
                throw new Error('ENOENT');
            }
        };
        const detect = detectApps({ platform: 'darwin', env: {}, fsImpl: f });
        assert.deepEqual(detect('resolume'), { path: '/Applications/Resolume Arena/mcp/resolume_arena_mcp_server', version: '7.26.0' });
    });
    test('resolume win32 with default ProgramFiles and env override', () => {
        const mk = (pf) => ({
            existsSync: (p) => String(p) === \`\${pf}\\\\Resolume Arena\\\\mcp\\\\resolume_arena_mcp_server.exe\`,
            readdirSync: () => { throw new Error('n/a'); },
            readFileSync: (p) => {
                if (String(p).includes('default.xml')) return '<version="7.27.1">';
                throw new Error('ENOENT');
            }
        });
        assert.deepEqual(detectApps({ platform: 'win32', fsImpl: mk('C:\\\\Program Files') })('resolume'),
            { path: 'C:\\\\Program Files\\\\Resolume Arena\\\\mcp\\\\resolume_arena_mcp_server.exe', version: '7.27.1' });
        assert.deepEqual(detectApps({ platform: 'win32', env: { ProgramFiles: 'D:\\\\PF' }, fsImpl: mk('D:\\\\PF') })('resolume'),
            { path: 'D:\\\\PF\\\\Resolume Arena\\\\mcp\\\\resolume_arena_mcp_server.exe', version: '7.27.1' });
    });
    test('fs errors -> null, never throws'`
);

// We need to fix both apps detected exactly one per group too
code = code.replace(
    /const detect = \(app\) => \(app === 'blender' \? \{ version: '5\.1' \} : app === 'resolume' \? \{ path: '\/x' \} : null\);/,
    `const detect = (app) => (app === 'blender' ? { version: '5.1' } : app === 'resolume' ? { path: '/x', version: '7.26.0' } : null);`
);

fs.writeFileSync('tests/mcp-pick.test.js', code);
