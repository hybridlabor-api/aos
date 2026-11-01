const fs = require('fs');
let code = fs.readFileSync('tests/mcp-pick.test.js', 'utf8');

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

fs.writeFileSync('tests/mcp-pick.test.js', code);
