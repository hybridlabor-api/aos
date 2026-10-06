const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pluginSkills } = require('../lib/plugin-evidence.js');

test('finds nested skills through plugin.json and rejects a foreign cache', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-evid-'));
    try {
        const root = path.join(home, '.claude', 'plugins', 'cache', 'bdb-marketplace', 'bdb-aos', '4.18.1');
        const put = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
        put('.claude-plugin/plugin.json', JSON.stringify({ skills: ['./skills/basic/startcycle', './skills/basic/other'] }));
        put('skills/basic/startcycle/SKILL.md', '#');
        put('skills/basic/other/SKILL.md', '#');
        put('skills/basic/unlisted/SKILL.md', '#');
        const r = pluginSkills(home, ['startcycle']);
        assert.ok(r && r.skills.has('startcycle') && r.skills.size === 2, 'listed skills only');
        assert.strictEqual(pluginSkills(home, ['missing']), null);
        assert.strictEqual(pluginSkills(fs.mkdtempSync(path.join(home, 'x-')), ['startcycle']), null);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
