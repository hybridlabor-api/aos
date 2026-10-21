'use strict';
// Fixture for migrateMemoryDirect: a memb-mcp venv and a deja binary inside a temp HOME, reachable through a
// temp PATH. Both components must exist, otherwise migration keeps the gateway copy (by design).
const fs = require('fs');
const path = require('path');

function fakeComponents(home) {
    const memb = path.join(home, '.gemini', 'config', 'mcps', 'memb-mcp');
    fs.mkdirSync(path.join(memb, '.venv', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(memb, '.venv', 'bin', 'python'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(memb, 'run.py'), '\n');
    const bin = path.join(home, 'fake-bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'deja'), '#!/bin/sh\n', { mode: 0o755 });
    return { ...process.env, PATH: bin };
}

module.exports = { fakeComponents };
