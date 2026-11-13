'use strict';
// OpenWiki 0.9 writes its pages to openwiki/ and reads them back through the ignore filter. With
// openwiki/ ignored, openwiki_submit_page fails with "Write <page> before submitting its page job".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE = path.join(__dirname, '..', 'skills', 'global_config', 'aos-project-init', 'assets', 'openwikiignore.template');

test('the shipped .openwikiignore template never ignores openwiki/', () => {
    const rules = fs.readFileSync(TEMPLATE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const bad = rules.filter((r) => /^\/?openwiki(\/(\*\*?)?)?$/i.test(r));
    assert.deepEqual(bad, []);
    assert.ok(rules.includes('.openwiki/'), 'the legacy .openwiki/ output folder stays ignored');
});
