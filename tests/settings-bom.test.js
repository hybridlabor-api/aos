// A settings.json saved with a UTF-8 BOM (Notepad, PowerShell 5.1 Out-File -Encoding utf8) must not break the readers; writes stay BOM-free.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pm = require('../lib/plugin-migration');
const profile = require('../lib/v5/profile');
const ur = require('../lib/uninstall-records');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bom-'));

test('registerClaude reads a BOM settings.json and writes it back without BOM', () => {
    const h = tmp();
    fs.mkdirSync(path.join(h, '.claude'));
    const file = path.join(h, '.claude', 'settings.json');
    fs.writeFileSync(file, '﻿' + JSON.stringify({ theme: 'dark' }));
    const r = pm.registerClaude({ home: h });
    assert.equal(r.ok, true, r.error);
    const raw = fs.readFileSync(file, 'utf8');
    assert.notEqual(raw.charCodeAt(0), 0xFEFF);
    assert.equal(JSON.parse(raw).theme, 'dark');
    fs.rmSync(h, { recursive: true, force: true });
});

test('v5 settings and uninstall records tolerate a BOM', () => {
    const h = tmp();
    fs.mkdirSync(path.join(h, '.aos'));
    fs.mkdirSync(path.join(h, '.agents'));
    fs.writeFileSync(profile.settingsFile(h), '﻿' + JSON.stringify({ profile: 'minimal' }));
    assert.equal(profile.readSettings(h, () => assert.fail('warned')).profile, 'minimal');
    fs.writeFileSync(ur.recordsPath(h), '﻿' + JSON.stringify({ npmGlobal: ['x'] }));
    assert.deepEqual(ur.readRecords(h).npmGlobal, ['x']);
    fs.rmSync(h, { recursive: true, force: true });
});
