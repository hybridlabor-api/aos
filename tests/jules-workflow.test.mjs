import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const wfPath = join(repoRoot, '.github', 'workflows', 'jules-task.yml');
const skillTemplatePath = join(repoRoot, '.github', 'ISSUE_TEMPLATE', 'aos-skill-request.yml');
const bugTemplatePath = join(repoRoot, '.github', 'ISSUE_TEMPLATE', 'aos-bug.yml');

const wf = readFileSync(wfPath, 'utf8');

// The 8 canonical categories defined in AGENTS.md and scripts/validate-skills.mjs
const EXPECTED_CATEGORIES = [
  'design-ui-ux',
  'engineering-method',
  'media-eventtech',
  'bdb-core',
  'saas-ops',
  'library',
  'engineering-hardware',
  'business-ops',
];

/**
 * Finds occurrences of ${{ github.event.issue inside `run:` blocks.
 */
export function findRunInterpolations(yamlContent) {
  const lines = yamlContent.split('\n');
  const interpolations = [];
  let inRun = false;
  let runIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inRun) {
      const match = line.match(/^(\s*)run:\s*(.*)$/);
      if (match) {
        runIndent = match[1].length;
        inRun = true;
        if (match[2] && /\$\{\{\s*github\.event\.issue/.test(match[2])) {
          interpolations.push({ line: i + 1, content: match[2] });
        }
      }
    } else {
      if (trimmed === '') continue;
      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent > runIndent) {
        if (/\$\{\{\s*github\.event\.issue/.test(line)) {
          interpolations.push({ line: i + 1, content: line });
        }
      } else {
        inRun = false;
        const match = line.match(/^(\s*)run:\s*(.*)$/);
        if (match) {
          runIndent = match[1].length;
          inRun = true;
          if (match[2] && /\$\{\{\s*github\.event\.issue/.test(match[2])) {
            interpolations.push({ line: i + 1, content: match[2] });
          }
        }
      }
    }
  }
  return interpolations;
}

/**
 * Checks for author association check (OWNER or MEMBER).
 */
export function hasAssociationCheck(yamlContent) {
  return (
    /github\.event\.issue\.author_association/.test(yamlContent) &&
    /OWNER/.test(yamlContent) &&
    /MEMBER/.test(yamlContent)
  );
}

/**
 * Returns any `uses:` entry not pinned to a 40-hex SHA.
 */
export function getUnpinnedUses(yamlContent) {
  const matches = [...yamlContent.matchAll(/^\s*(?:-\s*)?uses:\s*(.+)$/gm)].map((m) => m[1].trim());
  const unpinned = [];
  for (const u of matches) {
    const m = u.match(/^([\w./-]+)@([0-9a-f]{40})(?:\s*#.*)?$/);
    if (!m) {
      unpinned.push(u);
    }
  }
  return unpinned;
}

/**
 * Checks for repository confinement guard (vars.JULES_ALLOWED_REPO).
 */
export function hasRepoGuard(yamlContent) {
  return /github\.repository\s*==\s*vars\.JULES_ALLOWED_REPO/.test(yamlContent);
}

/**
 * Full security validation suite for Jules workflows.
 */
export function validateWorkflowSecurity(yamlContent) {
  const errors = [];
  const interpolations = findRunInterpolations(yamlContent);
  if (interpolations.length > 0) {
    errors.push(`Interpolation of github.event.issue inside run: block at line ${interpolations[0].line}`);
  }
  if (!hasAssociationCheck(yamlContent)) {
    errors.push('Missing author association check (github.event.issue.author_association must check OWNER and MEMBER)');
  }
  const unpinned = getUnpinnedUses(yamlContent);
  if (unpinned.length > 0) {
    errors.push(`Unpinned uses: ${unpinned.join(', ')}`);
  }
  if (!hasRepoGuard(yamlContent)) {
    errors.push('Missing repository guard: github.repository == vars.JULES_ALLOWED_REPO');
  }
  if (errors.length > 0) {
    throw new Error(`Security validation failed: ${errors.join('; ')}`);
  }
  return true;
}

// ---------------------------------------------------------------- Tests

test('jules-task workflow file exists on disk', () => {
  assert.ok(existsSync(wfPath), 'jules-task.yml must exist');
});

test('trigger is issues: [labeled] only and filters on aos-bug or aos-skill-request label', () => {
  assert.match(wf, /issues:\s*\n\s*types:\s*\[labeled\]/);
  assert.match(wf, /github\.event\.label\.name\s*==\s*['"](?:aos-bug|aos-skill-request)['"]/);
  assert.doesNotMatch(wf, /pull_request_target/);
});

test('permissions block is least-privilege read-only', () => {
  assert.match(wf, /permissions:\s*\n\s*contents:\s*read\s*\n\s*issues:\s*read/);
  assert.doesNotMatch(wf, /contents:\s*write/);
  assert.doesNotMatch(wf, /pull-requests:\s*write/);
  assert.doesNotMatch(wf, /issues:\s*write/);
});

test('repository guard prevents execution on public repo', () => {
  assert.ok(hasRepoGuard(wf), 'Must check github.repository == vars.JULES_ALLOWED_REPO');
});

test('author association guard ensures only OWNER or MEMBER triggers Jules', () => {
  assert.ok(hasAssociationCheck(wf), 'Must verify github.event.issue.author_association is OWNER or MEMBER');
});

test('zero interpolation of github.event.issue inside run: blocks', () => {
  const interpolations = findRunInterpolations(wf);
  assert.equal(
    interpolations.length,
    0,
    `Found dangerous interpolation in run block: ${JSON.stringify(interpolations)}`,
  );
});

test('issue title and body are passed strictly through env: block', () => {
  assert.match(wf, /ISSUE_TITLE:\s*\$\{\{\s*github\.event\.issue\.title\s*\}\}/);
  assert.match(wf, /ISSUE_BODY:\s*\$\{\{\s*github\.event\.issue\.body\s*\}\}/);
});

test('all uses: actions are pinned to 40-hex SHAs with a tag comment', () => {
  const unpinned = getUnpinnedUses(wf);
  assert.deepEqual(unpinned, [], `Unpinned actions found: ${unpinned.join(', ')}`);
});

test('dispatches directly to Jules API with AUTO_CREATE_PR and requirePlanApproval: false', () => {
  assert.match(wf, /https:\/\/jules\.googleapis\.com\/v1alpha\/sessions/);
  assert.match(wf, /requirePlanApproval:\s*false/);
  assert.match(wf, /automationMode:\s*"AUTO_CREATE_PR"/);
});

test('JULES_API_KEY is referenced strictly via secrets.JULES_API_KEY', () => {
  assert.match(wf, /(?:jules_api_key|JULES_API_KEY):\s*\$\{\{\s*secrets\.JULES_API_KEY\s*\}\}/);
  assert.match(wf, /X-Goog-Api-Key:\s*\$JULES_API_KEY/);
  assert.doesNotMatch(wf, /secrets\.GITHUB_TOKEN/);
});

test('jules-task workflow passes validateWorkflowSecurity', () => {
  assert.doesNotThrow(() => validateWorkflowSecurity(wf));
});

// Negative security test cases
test('negative: validateWorkflowSecurity rejects interpolation in run: block', () => {
  const maliciousWf = wf.replace(
    'echo "$ISSUE_BODY"',
    'echo "${{ github.event.issue.body }}"',
  );
  assert.throws(
    () => validateWorkflowSecurity(maliciousWf),
    /Interpolation of github\.event\.issue inside run: block/,
  );
});

test('negative: validateWorkflowSecurity rejects missing author association check', () => {
  const noAuthWf = wf.replace(
    /github\.event\.issue\.author_association\s*==\s*['"]OWNER['"]\s*\|\|\s*github\.event\.issue\.author_association\s*==\s*['"]MEMBER['"]/,
    'true',
  );
  assert.throws(
    () => validateWorkflowSecurity(noAuthWf),
    /Missing author association check/,
  );
});

test('negative: validateWorkflowSecurity rejects unpinned uses:', () => {
  const unpinnedWf = wf + '\n      - uses: actions/checkout@v4\n';
  assert.throws(
    () => validateWorkflowSecurity(unpinnedWf),
    /Unpinned uses:/,
  );
});

test('negative: validateWorkflowSecurity rejects missing repository guard', () => {
  const noRepoWf = wf.replace(
    'github.repository == vars.JULES_ALLOWED_REPO &&',
    '',
  );
  assert.throws(
    () => validateWorkflowSecurity(noRepoWf),
    /Missing repository guard/,
  );
});

// Issue template tests
if (existsSync(bugTemplatePath)) {
  test('aos-bug issue template exists and specifies label aos-bug', () => {
    const bugTemplate = readFileSync(bugTemplatePath, 'utf8');
    assert.match(bugTemplate, /labels:\s*\[\s*["']?aos-bug["']?\s*\]/);
    for (const id of ['target_repo', 'what_happens', 'expected', 'steps', 'done_when']) {
      const idRegex = new RegExp(`id:\\s*${id}[\\s\\S]*?required:\\s*true`, 'm');
      assert.match(bugTemplate, idRegex, `Field ${id} must exist and be required: true`);
    }
  });
}

if (existsSync(skillTemplatePath)) {
  const skillTemplate = readFileSync(skillTemplatePath, 'utf8');

  test('aos-skill-request issue template specifies label aos-skill-request', () => {
    assert.match(skillTemplate, /labels:\s*\[\s*["']aos-skill-request["']\s*\]/);
  });

  test('issue template has required fields: name, source_url, source_license, attribution, category', () => {
    const requiredIds = ['name', 'source_url', 'source_license', 'attribution', 'category'];
    for (const id of requiredIds) {
      const idRegex = new RegExp(`id:\\s*${id}[\\s\\S]*?required:\\s*true`, 'm');
      assert.match(skillTemplate, idRegex, `Field ${id} must exist and be required: true`);
    }
  });

  test('issue template category dropdown matches canonical 8 categories from AGENTS.md', () => {
    for (const cat of EXPECTED_CATEGORIES) {
      assert.match(
        skillTemplate,
        new RegExp(`-\\s*${cat}\\b`),
        `Category ${cat} must be an option in dropdown`,
      );
    }
  });

  test('issue template instructs Jules to read skill contract and run npm run validate', () => {
    assert.match(skillTemplate, /skills\/skill-create\/SKILL\.md/);
    assert.match(skillTemplate, /AGENTS\.md/);
    assert.match(skillTemplate, /npm run validate/);
  });
}
