const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '.claude', 'hooks', 'conventional-commits.mjs')));

test('heredoc commit with a conventional subject is allowed', async () => {
    const { checkConventionalCommit } = await load();
    const cmd = "git commit -m \"$(cat <<'EOF'\nfix(api): handle null\n\nbody\nEOF\n)\"";
    assert.strictEqual(checkConventionalCommit(cmd), null);
});

test('heredoc, -am and --message forms with a bad subject are blocked', async () => {
    const { checkConventionalCommit } = await load();
    assert.ok(checkConventionalCommit("git commit -m \"$(cat <<'EOF'\nAdded stuff\nEOF\n)\""));
    assert.ok(checkConventionalCommit('git commit -am "Added stuff"'));
    assert.ok(checkConventionalCommit('git commit --message "Added stuff"'));
    assert.ok(checkConventionalCommit('git commit --message="Added stuff"'));
    assert.strictEqual(checkConventionalCommit('git commit -am "feat: ok"'), null);
    assert.ok(checkConventionalCommit('git add . && git commit -m "bad"'));
});

test('text that only mentions the command is not a commit', async () => {
    const { checkConventionalCommit } = await load();
    assert.strictEqual(checkConventionalCommit('echo "run git commit -m x later" > notes.md'), null);
    assert.strictEqual(checkConventionalCommit("cat <<'EOF' > docs.md\nuse git commit -m \"bad\"\nEOF"), null);
});
