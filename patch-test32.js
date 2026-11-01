const fs = require('fs');
let code = fs.readFileSync('lib/mcp-pick.js', 'utf8');

code = code.replace(
    /if \(app === 'resolume'\) \{\s*if \(platform === 'darwin'\) \{\s*const p = '\/Applications\/Resolume Arena\/mcp\/resolume_arena_mcp_server';\s*return fsExists\(p\) \? \{ path: p \} : null;\s*\}\s*if \(platform === 'win32'\) \{\s*const p = path\.win32\.join\(progFiles, 'Resolume Arena', 'mcp', 'resolume_arena_mcp_server\.exe'\);\s*return fsExists\(p\) \? \{ path: p \} : null;\s*\}\s*return null;\s*\}/,
    `if (app === 'resolume') {
            const getVer = (base) => {
                try {
                    const txt = f.readFileSync(path.join(base, 'default.xml'), 'utf8');
                    const m = /version="([^"]+)"/.exec(txt);
                    return m ? m[1] : null;
                } catch { return null; }
            };
            if (platform === 'darwin') {
                const p = '/Applications/Resolume Arena/mcp/resolume_arena_mcp_server';
                return fsExists(p) ? { path: p, version: getVer('/Applications/Resolume Arena') } : null;
            }
            if (platform === 'win32') {
                const p = path.win32.join(progFiles, 'Resolume Arena', 'mcp', 'resolume_arena_mcp_server.exe');
                return fsExists(p) ? { path: p, version: getVer(path.win32.join(progFiles, 'Resolume Arena')) } : null;
            }
            return null;
        }`
);

fs.writeFileSync('lib/mcp-pick.js', code);
