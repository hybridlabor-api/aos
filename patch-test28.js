const fs = require('fs');
let code = fs.readFileSync('tests/mcp-pick.test.js', 'utf8');

code = code.replace(
    /assert\.deepEqual\(detect\('resolume'\), \{ path: '\/Applications\/Resolume Arena\/mcp\/resolume_arena_mcp_server' \}\);/,
    `assert.deepEqual(detect('resolume'), { path: '/Applications/Resolume Arena/mcp/resolume_arena_mcp_server', version: '7.26.0' });`
);

code = code.replace(
    /assert\.deepEqual\(detectApps\(\{ platform: 'win32', fsImpl: mk\('C:\\\\Program Files'\) \}\)\('resolume'\),\s*\{ path: 'C:\\\\Program Files\\\\Resolume Arena\\\\mcp\\\\resolume_arena_mcp_server\.exe' \}\);/,
    `assert.deepEqual(detectApps({ platform: 'win32', fsImpl: mk('C:\\\\Program Files') })('resolume'),
            { path: 'C:\\\\Program Files\\\\Resolume Arena\\\\mcp\\\\resolume_arena_mcp_server.exe', version: '7.27.1' });`
);

code = code.replace(
    /assert\.deepEqual\(detectApps\(\{ platform: 'win32', env: \{ ProgramFiles: 'D:\\\\PF' \}, fsImpl: mk\('D:\\\\PF'\) \}\)\('resolume'\),\s*\{ path: 'D:\\\\PF\\\\Resolume Arena\\\\mcp\\\\resolume_arena_mcp_server\.exe' \}\);/,
    `assert.deepEqual(detectApps({ platform: 'win32', env: { ProgramFiles: 'D:\\\\PF' }, fsImpl: mk('D:\\\\PF') })('resolume'),
            { path: 'D:\\\\PF\\\\Resolume Arena\\\\mcp\\\\resolume_arena_mcp_server.exe', version: '7.27.1' });`
);

fs.writeFileSync('tests/mcp-pick.test.js', code);
