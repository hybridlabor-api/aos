// bdb-updater was renamed to aos-update and stays as a stub: an untouched old copy is replaced by the stub
// on update, an edited copy is kept (with .new). Temp HOME only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-alias-'));
process.env.HOME = root;
process.env.USERPROFILE = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const installer = require('../installer.js');

const stub = path.join(__dirname, '..', 'skills', 'global_config', 'bdb-updater', 'SKILL.md');
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const put = (name, text) => { const f = path.join(root, name, 'SKILL.md'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

test('unmodified old bdb-updater copy is replaced by the alias stub; an edited one is kept', () => {
    installer.setShippedHashes(new Set());
    const old = '# old full bdb-updater\n';
    const clean = put('clean', old);
    const edited = put('edited', 'user edit\n');
    const manifest = { [clean]: { sha256: sha(old) }, [edited]: { sha256: sha(old) } };
    assert.strictEqual(installer.resolveFileConflict(stub, clean, manifest, new Set()), 'wrote');
    assert.match(fs.readFileSync(clean, 'utf8'), /aos-update/);
    assert.strictEqual(installer.resolveFileConflict(stub, edited, manifest, new Set()), 'kept');
    assert.strictEqual(fs.readFileSync(edited, 'utf8'), 'user edit\n');
});
