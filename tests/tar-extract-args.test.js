const { test } = require('node:test');
const assert = require('node:assert');
const { tarExtractArgs } = require('../lib/tar-extract-args');

test('Windows path: no tar argument starts with a drive letter', () => {
    const { args, cwd } = tarExtractArgs('C:\\Users\\x\\a.tgz', 'C:\\Users\\x\\a.incoming-1');
    for (const arg of args) assert.doesNotMatch(arg, /^[A-Za-z]:/);
    assert.deepStrictEqual(args, ['-xzf', 'a.tgz', '--strip-components=1', '-C', 'a.incoming-1']);
    assert.strictEqual(cwd, 'C:\\Users\\x');
});

test('Windows sibling destination resolves relative to the tarball directory', () => {
    const { args } = tarExtractArgs('C:\\Users\\x\\memb\\a.tgz', 'C:\\Users\\x\\memb.incoming-1');
    assert.deepStrictEqual(args.slice(-2), ['-C', '../memb.incoming-1']);
});

test('POSIX paths', () => {
    const { args, cwd } = tarExtractArgs('/home/x/memb/a.tgz', '/home/x/memb.incoming-1');
    assert.deepStrictEqual(args, ['-xzf', 'a.tgz', '--strip-components=1', '-C', '../memb.incoming-1']);
    assert.strictEqual(cwd, '/home/x/memb');
});
