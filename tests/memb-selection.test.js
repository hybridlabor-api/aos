const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');

// memb-mcp (CORE_MCP) is downloaded from npm at install time, so it is not a
// folder under mcps/ and fs.readdirSync never lists it. promptMcpSelection()
// must still include it in the selection it returns — otherwise with -y or
// --mcps= it is never selected and its config placeholders are never
// substituted.
test('promptMcpSelection returns memb-mcp even though it has no mcps/ folder', () => {
    const script = `
        const installer = require('./installer.js');
        installer.promptMcpSelection('1').then((result) => {
            console.log(JSON.stringify(result));
        }).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
    `;
    const stdout = execFileSync(process.execPath, ['-e', script, '--', '-y'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
    const lastLine = stdout.split('\n').filter(l => l.trim() !== '').pop();
    const result = JSON.parse(lastLine);
    assert.ok(Array.isArray(result), `expected an array, got: ${lastLine}`);
    assert.ok(result.includes('memb-mcp'), `expected memb-mcp in ${JSON.stringify(result)}`);
});
