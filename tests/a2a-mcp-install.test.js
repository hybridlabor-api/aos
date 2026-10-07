// WP-INSTALL (A2A MCP): installer registration, env verification and uninstall cleanup.
// Runs against a temp HOME under os.tmpdir() -- never touches real home.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const INSTALLER = path.join(REPO, 'installer.js');
const DOCTOR = path.join(REPO, 'bin', 'aos-doctor.mjs');

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-mcp-home-'));
}

function childEnv(home) {
  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_CONFIG_DIR;
  return env;
}

describe('A2A MCP Installer Integration', () => {
  const installer = require(INSTALLER);

  test('makeAosA2aMcpEntry requires non-empty session name', () => {
    assert.throws(() => installer.makeAosA2aMcpEntry(''), /AOS_A2A_NAME is required/);
    assert.throws(() => installer.makeAosA2aMcpEntry('   '), /AOS_A2A_NAME is required/);
    assert.throws(() => installer.makeAosA2aMcpEntry(null), /AOS_A2A_NAME is required/);

    const entry = installer.makeAosA2aMcpEntry('test-worker', '/custom/home');
    assert.equal(entry.command, 'node');
    assert.deepEqual(entry.args, [path.join('/custom/home', '.agents', 'bin', 'aos-a2a-mcp.mjs')]);
    assert.equal(entry.env.AOS_A2A_NAME, 'test-worker');
  });

  test('registerA2aMcpCursor writes valid entry with AOS_A2A_NAME and preserves existing servers', () => {
    const home = makeTempHome();
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    const cursorFile = path.join(cursorDir, 'mcp.json');

    // Pre-populate user's custom MCP server
    fs.writeFileSync(cursorFile, JSON.stringify({
      mcpServers: {
        custom_tool: { command: 'echo', args: ['hello'] }
      }
    }, null, 2));

    installer.registerA2aMcpCursor({ targetHome: home, name: 'cursor-agent' });

    const updated = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    assert.ok(updated.mcpServers.custom_tool, 'pre-existing server must be preserved');
    assert.ok(updated.mcpServers['aos-a2a'], 'aos-a2a must be registered');
    assert.equal(updated.mcpServers['aos-a2a'].env.AOS_A2A_NAME, 'cursor-agent');
    assert.match(updated.mcpServers['aos-a2a'].args[0], /aos-a2a-mcp\.mjs$/);
  });

  test('registerA2aMcpAgy writes valid entry to agy mcp_config files', () => {
    const home = makeTempHome();
    const agyConfigDir = path.join(home, '.gemini', 'config');
    fs.mkdirSync(agyConfigDir, { recursive: true });
    const agyFile = path.join(agyConfigDir, 'mcp_config.json');

    installer.registerA2aMcpAgy({ targetHome: home, name: 'agy-worker' });

    assert.ok(fs.existsSync(agyFile));
    const cfg = JSON.parse(fs.readFileSync(agyFile, 'utf8'));
    assert.ok(cfg.mcpServers['aos-a2a']);
    assert.equal(cfg.mcpServers['aos-a2a'].env.AOS_A2A_NAME, 'agy-worker');
  });

  test('removeAosA2aEntries deletes only AOS-owned entries, never user custom entries', () => {
    const home = makeTempHome();
    const cursorDir = path.join(home, '.cursor');
    fs.mkdirSync(cursorDir, { recursive: true });
    const cursorFile = path.join(cursorDir, 'mcp.json');

    // Case 1: AOS-owned entry + user custom entry
    installer.registerA2aMcpCursor({ targetHome: home, name: 'cursor-agent' });
    const beforeData = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    beforeData.mcpServers.user_tool = { command: 'node', args: ['/path/to/user/tool.js'] };
    fs.writeFileSync(cursorFile, JSON.stringify(beforeData, null, 2));

    installer.removeAosA2aEntries({ targetHome: home });

    const afterData = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    assert.equal(afterData.mcpServers['aos-a2a'], undefined, 'AOS-owned entry must be removed');
    assert.ok(afterData.mcpServers.user_tool, 'User-owned entry must be kept');

    // Case 2: User custom entry coincidentally named 'aos-a2a' pointing elsewhere
    afterData.mcpServers['aos-a2a'] = { command: 'node', args: ['/my/custom/fake-server.js'] };
    fs.writeFileSync(cursorFile, JSON.stringify(afterData, null, 2));

    installer.removeAosA2aEntries({ targetHome: home });

    const finalData = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    assert.ok(finalData.mcpServers['aos-a2a'], 'User entry with custom script must NOT be removed');
  });

  test('aos doctor checks A2A Cursor and agy registrations', () => {
    const home = makeTempHome();
    installer.registerA2aMcpCursor({ targetHome: home, name: 'cursor-peer' });

    const r = spawnSync(process.execPath, [DOCTOR], { env: childEnv(home), encoding: 'utf8', timeout: 30000 });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /A2A Cursor MCP/);
    assert.match(out, /cursor-peer/);
  });
});
