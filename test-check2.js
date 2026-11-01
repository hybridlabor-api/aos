const { applyPicks } = require('./lib/mcp-pick');
const picksJson = require('./mcp_picks.json');
const servers = {
        bdb_blender_official_mcp: { command: 'uvx', args: ['--from', 'git+x@ff54e4d#subdirectory=mcp', 'blender-mcp'] },
        bdb_blender_mcp: { command: 'uv', args: ['--directory', '__MCPS_DIR__/blender-mcp', 'run', '-m', 'blender_mcp.server'] },
        bdb_resolume_official_mcp: { command: '__RESOLUME_MCP__', args: [] },
        bdb_resolume_mcp: { command: 'uv', args: ['run', '__MCPS_DIR__/resolume_mcp.py'] },
        github: { command: 'npx', args: ['-y', 'pkg'] },
    };
const detect = (app) => (app === 'resolume' ? { version: '7.25.0', path: '/opt/arena/mcp/resolume_arena_mcp_server' } : null);
const r = applyPicks(servers, picksJson.groups, detect);
console.log(r);
