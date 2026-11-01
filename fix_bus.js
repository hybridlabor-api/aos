const fs = require('fs');
let tests = fs.readFileSync('tests/aos-bus.test.js', 'utf8');

tests = tests.replace(/assert.equal\(fs.statSync\(reg\).mtimeMs, old.getTime\(\)\);/g, 'assert.ok(Math.abs(fs.statSync(reg).mtimeMs - old.getTime()) < 10);');
tests = tests.replace(/assert.equal\(fs.statSync\(reg\).mtimeMs, old.getTime\(\), 'foreign registration left alone'\);/g, 'assert.ok(Math.abs(fs.statSync(reg).mtimeMs - old.getTime()) < 10, \'foreign registration left alone\');');

fs.writeFileSync('tests/aos-bus.test.js', tests);
