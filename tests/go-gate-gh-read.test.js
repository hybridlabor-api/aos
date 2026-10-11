// Read-only gh calls with jq filters were "unscoped" (a fresh GO each time): the quoted
// filter stayed command text and the segment split read `.[]|.x[0:8]` as a new command.
// Offline; the gate only classifies these strings, nothing here executes them.
const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const GATE = path.resolve(__dirname, '..', '.claude', 'hooks', 'go-gate.mjs');
let g;
before(async () => { g = await import(pathToFileURL(GATE).href); g.setGateContext({ cwd: process.cwd(), blockTs: 0 }); });

const FREE = [
    "gh run list --json headSha -q '.[]|.headSha[0:8]'",
    "gh run list -R hybridlabor-api/aos --workflow release-please.yml --limit 2 --json status,conclusion,headSha -q '.[]|.status+\" \"+.conclusion+\" \"+.headSha[0:8]'",
    "gh run view 38112147114 -R hybridlabor-api/aos --json conclusion,jobs -q '.conclusion, (.jobs[]|.name+\" \"+([.steps[]|select(.conclusion!=\"success\")|.name]|join(\",\")))'",
    "gh pr list --repo=o/r --json number -q '.[]|\"#\\(.number)\"'",
    "gh pr view 143 --json files -q '.files[]|.path'",
    "gh pr checks 142 -R o/r",
    "gh search prs 'is:open label:x|y[1]'",
    "gh --version",
];
const GUARDED = [
    "gh pr view 1 \"$(git push origin main)\"",
    "gh pr list -q '.[]' ; git push origin main",
    "gh pr merge 142 -R o/r",
    "gh pr create --title 'a|b[0:8]' --body x",
    "gh release create v1 --notes 'x|y[0]'",
    "gh api repos/o/r/pulls -X POST -f title='a|b[0]'",
];

test('read-only gh calls with jq filters are free', () => {
    for (const c of FREE) assert.deepEqual(g.commandScopes(c), [], c);
});

test('writes and command substitutions stay guarded', () => {
    for (const c of GUARDED) assert.ok(g.isGuardedCommand(c), c);
});

test('aos-uninstall needs a plain GO unless it is a dry run', () => {
    for (const c of ['aos-uninstall', 'aos-uninstall --purge --yes', 'npx -p @hybridlabor-api/aos aos-uninstall --yes', 'node ~/.agents/bin/aos-uninstall.mjs', '~/.local/bin/aos-uninstall --yes'])
        assert.equal(g.commandScopes(c), null, c);
    for (const c of ['aos-uninstall --dry-run', 'npx -p @hybridlabor-api/aos aos-uninstall --dry-run', 'grep -n aos-uninstall README.md'])
        assert.deepEqual(g.commandScopes(c), [], c);
});

test('store logs can be read through pure stdin filters; writes stay blocked', () => {
    const LOG = '/Users/x/.aos/gate/s.log';
    for (const c of [`tail -40 ${LOG} | cut -c1-260`, `cat ${LOG} | sort | uniq -c`, `grep -c deny ${LOG} | tr -d ' '`, 'ls -la ~/.aos/gate/ | head -20'])
        assert.equal(g.gateStoreReason(c), null, c);
    for (const c of [`cat ${LOG} | sort -o ${LOG}`, `cat ${LOG} | uniq - ${LOG}`, `tail ${LOG} | tee ${LOG}`, `tail ${LOG} | sed -i d ${LOG}`, `tail ${LOG} | sh`])
        assert.ok(g.gateStoreReason(c), c);
});
