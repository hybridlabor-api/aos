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
  const env = { ...process.env, HOME: home, USERPROFILE: home };
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

  // B2: a config that does not parse is never rewritten — the user's file stays byte for byte.
  test('registerA2aMcpCursor leaves a corrupt mcp.json untouched and warns (never rewrites an unparseable file)', () => {
    const home = makeTempHome();
    const cursorFile = path.join(home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
    const corrupt = '{"mcpServers": { bad'; // truncated JSON
    fs.writeFileSync(cursorFile, corrupt);

    let seen = '';
    const origOut = process.stdout.write.bind(process.stdout), origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (s, ...a) => { seen += String(s); return origOut(s, ...a); };
    process.stderr.write = (s, ...a) => { seen += String(s); return origErr(s, ...a); };
    try {
      installer.registerA2aMcpCursor({ targetHome: home, name: 'cursor-agent' });
    } finally {
      process.stdout.write = origOut, process.stderr.write = origErr;
    }
    assert.equal(fs.readFileSync(cursorFile, 'utf8'), corrupt, 'the corrupt config must stay unchanged');
    assert.ok(!fs.readdirSync(path.dirname(cursorFile)).some((f) => f.endsWith('.bak')), 'no backup/rewrite may result from an unparseable file');
    const cfg = fs.readFileSync(cursorFile, 'utf8');
    assert.ok(!cfg.includes('aos-a2a-mcp.mjs'), 'an AOS entry must not have been injected');
    // warnUnparseable must have fired (B2): a warning naming the file, not a failed install
    assert.match(seen, /Could not parse/, `a warning for the unparseable file must be emitted (seen=${JSON.stringify(seen)})`);
  });

  // B3: a foreign "aos-a2a" entry (same key, different command) is never overwritten.
  test('registerA2aMcpCursor never overwrites a foreign aos-a2a entry with the same key', () => {
    const home = makeTempHome();
    const cursorFile = path.join(home, '.cursor', 'mcp.json');
    fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
    const foreign = { command: 'node', args: ['/users/own/proxy.js'], env: { FOO: '1' } };
    fs.writeFileSync(cursorFile, JSON.stringify({ mcpServers: { 'aos-a2a': foreign } }, null, 2));

    installer.registerA2aMcpCursor({ targetHome: home, name: 'cursor-agent' });

    const cfg = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
    assert.deepEqual(cfg.mcpServers['aos-a2a'], foreign, 'the foreign entry must survive untouched');
    assert.match(cfg.mcpServers['aos-a2a'].args[0], /proxy\.js$/, 'the foreign script must still be referenced');
  });

  // B4 on the agy side: removal takes only AOS-owned entries, foreign ones survive.
  test('removeAosA2aEntries cleans the agy configs too and keeps foreign entries there', () => {
    const home = makeTempHome();
    const agyConfigDir = path.join(home, '.gemini', 'config');
    fs.mkdirSync(agyConfigDir, { recursive: true });
    const agyFile = path.join(agyConfigDir, 'mcp_config.json');
    installer.registerA2aMcpAgy({ targetHome: home, name: 'agy-worker' });
    const data = JSON.parse(fs.readFileSync(agyFile, 'utf8'));
    data.mcpServers.foreign_tool = { command: 'node', args: ['/mix/not-aos.mjs'] };
    fs.writeFileSync(agyFile, JSON.stringify(data, null, 2));

    const cleaned = installer.removeAosA2aEntries({ targetHome: home });

    const after = JSON.parse(fs.readFileSync(agyFile, 'utf8'));
    assert.ok(after.mcpServers.foreign_tool, 'foreign agy entry must survive');
    assert.equal(after.mcpServers['aos-a2a'], undefined, 'AOS-owned agy entry must be removed');
    assert.ok(cleaned.includes(agyFile), `the cleaned file must be reported (got ${JSON.stringify(cleaned)})`);
  });

  test('bin/aos-uninstall.mjs is wired to removeAosA2aEntries', () => {
    const src = fs.readFileSync(path.join(REPO, 'bin', 'aos-uninstall.mjs'), 'utf8');
    assert.match(src, /removeAosA2aEntries/, 'the uninstaller must actually call the A2A entry removal');
    assert.match(src, /targetHome|home/, 'the removal must be scoped to the home');
  });

  // B5: fixed, distinct defaults per harness; overrides validate through validName rules.
  test('A2A MCP session names: fixed distinct defaults, invalid overrides fall back with a warning', () => {
    let warned = '';
    const origErr = process.stderr.write.bind(process.stderr), origOut = process.stdout.write.bind(process.stdout);
    process.stderr.write = (s, ...a) => { warned += String(s); return origErr(s, ...a); };
    process.stdout.write = (s, ...a) => { warned += String(s); return origOut(s, ...a); };
    try {
      assert.equal(installer.resolveAosA2aMcpName(null, 'cursor-mcp', 'Cursor'), 'cursor-mcp', 'missing override -> fixed default');
      assert.equal(installer.resolveAosA2aMcpName('ok-name_1', 'agy-mcp', 'agy'), 'ok-name_1', 'a valid override passes through');
      assert.equal(installer.resolveAosA2aMcpName('bad name!', 'cursor-mcp', 'Cursor'), 'cursor-mcp', 'invalid override -> fallback');
      assert.equal(installer.resolveAosA2aMcpName('../evil', 'agy-mcp', 'agy'), 'agy-mcp', 'path traversal override -> fallback');
      assert.equal(installer.resolveAosA2aMcpName('a'.repeat(70), 'cursor-mcp', 'Cursor'), 'cursor-mcp', 'too-long override -> fallback');
    } finally {
      process.stderr.write = origErr, process.stdout.write = origOut;
    }
    assert.match(warned, /not a valid A2A session name/, `the fallback must be announced (got ${JSON.stringify(warned)})`);
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

// WP-A2A-MCP-4 final round (Opus re-check APPROVE-WITH-FIXES): B5 spurious warning, exclusive
// backups per write and the atomic tmp-then-rename write for the A2A MCP registration helpers.
describe('A2A MCP Installer Hardening (WP-A2A-MCP-4)', () => {
  const installer = require(INSTALLER);

  test('B5: resolveAosA2aMcpName warns only when an override is SET and invalid, never for an unset one', () => {
    let seen = '';
    const origOut = process.stdout.write.bind(process.stdout), origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (s, ...a) => { seen += String(s); return origOut(s, ...a); };
    process.stderr.write = (s, ...a) => { seen += String(s); return origErr(s, ...a); };
    try {
      assert.equal(installer.resolveAosA2aMcpName(null, 'cursor-mcp', 'Cursor'), 'cursor-mcp');
      assert.equal(installer.resolveAosA2aMcpName(undefined, 'agy-mcp', 'agy'), 'agy-mcp');
    } finally {
      process.stdout.write = origOut, process.stderr.write = origErr;
    }
    assert.doesNotMatch(seen, /not a valid A2A session name/, `an unset override must not warn (seen=${JSON.stringify(seen)})`);
    // sanity: a set-but-invalid override still warns and falls back
    let seen2 = '';
    process.stdout.write = (s, ...a) => { seen2 += String(s); return origOut(s, ...a); };
    process.stderr.write = (s, ...a) => { seen2 += String(s); return origErr(s, ...a); };
    try {
      assert.equal(installer.resolveAosA2aMcpName('bad name!', 'cursor-mcp', 'Cursor'), 'cursor-mcp');
    } finally {
      process.stdout.write = origOut, process.stderr.write = origErr;
    }
    assert.match(seen2, /not a valid A2A session name/, 'a set invalid override must still warn');
  });

  test('hardening: two writes to one config in one process keep two distinct backups, the first holding the ORIGINAL content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-bak-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { mine: { command: 'echo' } } }, null, 2));
    const original = fs.readFileSync(file, 'utf8');

    installer.writeConfigWithBackup(file, { mcpServers: { aos_stuff: 1 } }, original);
    installer.writeConfigWithBackup(file, { mcpServers: { aos_stuff: 2 } }, JSON.stringify({ mcpServers: { aos_stuff: 1 } }));

    const backups = fs.readdirSync(dir)
      .filter((f) => /\.bak(\.\d+)?$/.test(f))
      .map((f) => ({ f, suffixed: /\.bak\.\d+$/.test(f), content: fs.readFileSync(path.join(dir, f), 'utf8') }));
    assert.equal(backups.length, 2, `two distinct backups expected (${JSON.stringify(backups.map((x) => x.f))})`);
    assert.equal(new Set(backups.map((x) => x.f)).size, 2, 'backup names must be distinct');
    const first = JSON.parse(fs.readFileSync(path.join(dir, backups.find((x) => !x.suffixed).f), 'utf8'));
    const second = JSON.parse(fs.readFileSync(path.join(dir, backups.find((x) => x.suffixed).f), 'utf8'));
    assert.deepEqual(first, { mcpServers: { mine: { command: 'echo' } } }, 'the FIRST backup must still hold the ORIGINAL content');
    assert.deepEqual(second, { mcpServers: { aos_stuff: 1 } }, 'the second backup must hold the post-first-write content');
  });

  test('hardening: a failing rename between tmp write and replace leaves the original config intact with no temp leftovers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-bak2-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { mine: { command: 'echo' } } }, null, 2));
    const original = fs.readFileSync(file, 'utf8');

    const realRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('simulated crash before rename'); };
    let result;
    try {
      result = installer.writeConfigWithBackup(file, { changed: true }, original);
    } finally {
      fs.renameSync = realRename;
    }
    assert.equal(result, false, 'a failed write is reported false, never a silent success');
    assert.equal(fs.readFileSync(file, 'utf8'), original, 'the original file must be byte for byte intact');
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, [], 'no temp file may survive a failed write');
  });
});
