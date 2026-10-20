import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tplDir = path.join(root, 'skills/global_config/plan-canvas/scripts/lib/plan-builder/templates');
const templates = new Set(fs.readdirSync(tplDir));

const map = {
  'basic/godmode-engineering': ['architecture', 'bugfix', 'migration', 'research'],
  'basic/godmode-ui-ux': ['feature', 'recap-board'],
  'basic/godmode-shipping': ['release', 'recap-review'],
  'basic/godmode-eventtech': ['show-control'],
  'basic/godmode-media-creation': ['feature', 'research'],
  'basic/godmode-3d-creation': ['research'],
  'basic/godmode-hardware-pcb': ['architecture'],
  'basic/bdbmediastorm': ['show-control'],
  'basic/bdb-eventagency-skill': ['show-control', 'release'],
  'global_config/pr-recap': ['recap-review'],
  'global_config/requesting-code-review': ['recap-review'],
  'global_config/two-axis-code-review': ['recap-review'],
  'global_config/finishing-a-development-branch': ['recap-review'],
  'playbooks/pb-worktrees-land': ['recap-review'],
  'global_config/quick-recap': ['recap'],
  'playbooks/pb-handover': ['recap'],
  'global_config/bdb-visual-edit': ['recap-board'],
  'playbooks/pb-redesign-app': ['recap-board'],
  'global_config/systematic-debugging': ['bugfix'],
  'global_config/diagnosing-bugs': ['bugfix'],
  'playbooks/pb-bug-fix': ['bugfix'],
  'playbooks/pb-ci-fix': ['bugfix'],
  'playbooks/pb-ship': ['release'],
  'playbooks/pb-release-aos': ['release'],
  'global_config/golive': ['release'],
  'global_config/deep-research': ['research'],
  'global_config/plan-arbiter': ['research'],
  'playbooks/pb-landing-page': ['feature'],
  'playbooks/pb-idea-to-launch': ['feature'],
  'global_config/prototype': ['feature'],
  'global_config/software-architecture': ['architecture'],
  'global_config/architect-review': ['architecture'],
  'global_config/database-design': ['migration'],
  'playbooks/pb-show-build': ['show-control'],
  'playbooks/pb-crew-call-sheet': ['show-control'],
};

for (const [skill, ids] of Object.entries(map)) {
  test(`${skill} has a Plan first section with valid template ids`, () => {
    const text = fs.readFileSync(path.join(root, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(text, /^#{2,3} Plan first$/m);
    assert.ok(text.includes('aos-plan-canvas open <plan-dir> --mode bdb-plan-builder'));
    assert.ok(text.includes('aos-plan-canvas await <plan-dir>/plan.mdx'));
    assert.ok(text.includes('aos-plan-canvas trail <plan-dir>'));
    for (const id of ids) {
      assert.ok(templates.has(id), `unknown template ${id}`);
      assert.ok(text.includes(`\`${id}\``), `${skill} does not name ${id}`);
    }
  });
}

test('plan-canvas table lists every mapped skill under Used by', () => {
  const text = fs.readFileSync(path.join(root, 'skills/global_config/plan-canvas/SKILL.md'), 'utf8');
  assert.ok(text.includes('| Used by |'));
  for (const skill of Object.keys(map)) {
    const name = skill.split('/')[1];
    assert.ok(new RegExp(`^\\| \`[a-z-]+\` \\|.*\\b${name}\\b.*\\|$`, 'm').test(text), `${name} missing from table`);
  }
});
