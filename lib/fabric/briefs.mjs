// Brief text for one fabric step. Pure: the engine writes it to briefs/<step_id>.md, the executor reads it.
// The Reviewer brief carries no goal and no claim of any other node (graph.md, "Reviewer discipline").

import { GATE_KEYS } from './schema.mjs';

const list = (items) => items.map((x) => `- ${x}`).join('\n');
const quoted = (ids) => ids.map((s) => `"${s}"`).join(', ');
const openBlocking = (findings) => findings.filter((f) => f.severity === 'blocking' && f.status === 'open');
const describe = (f) => `[${f.id}] (${f.node}) ${f.summary || '(no summary)'}`;

function reportContract(step, extra) {
  const skeleton = JSON.stringify({
    schema: 'aos.fabric.report/1', step_id: step.step_id, status: 'ok', exit_code: 0, findings: [], artifacts: {},
    files_changed: [], needs_human: false, executor: { name: '<your name>', harness: '<your harness>', model: '<your model>' },
  }, null, 2);
  return [
    '## Report (required)',
    '',
    `Write exactly one JSON object to \`${step.expected_report}\` (create the folder if needed). If you cannot write files, print the same object as the last JSON object of your final message.`,
    '',
    '```json',
    skeleton,
    '```',
    '',
    '- `status`: "ok" when the work is done, "fail" when you could not do it, "escalate" only when a human must decide (then set `needs_human` to true).',
    '- `findings`: `{ "id", "severity": "blocking"|"advisory", "node", "summary", "status": "open"|"fixed"|"wont_fix" }`.',
    ...extra,
    '- Only the files this step needs may change. Never edit `production_artifacts/runs/` (the run store belongs to `aos-fabric`) and never call other agents or nodes: the dispatcher decides every next step.',
  ].join('\n');
}

function skillsNote(node, common, mandatory, step) {
  const own = [...new Set([...common, ...(node.skills ?? [])])];
  const parts = [];
  if (own.length) parts.push(`Prefer these skills for this work: ${own.join(', ')}. Any other installed skill may be used when the task genuinely calls for it.`);
  if (mandatory.length) {
    if (step.kind === 'build' || step.node === 'architect') {
      parts.push(`The user required these skills for this run: ${mandatory.join(', ')}. This is a hard requirement, not a suggestion: apply their guidance and name in your report how each one was applied.`);
    } else if (step.kind === 'techlead') {
      parts.push(`The user required these skills for this run: ${mandatory.join(', ')}. Reject the plan if it does not account for them.`);
    } else if (step.kind === 'review') {
      parts.push(`The user required these skills for this run: ${mandatory.join(', ')}. If an artifact shows no sign of applying a skill's guidance, that is a contract misread: a blocking finding owned by the build node that should have applied it. A skill being merely available is not enough.`);
    }
  }
  return parts.join('\n\n');
}

// ctx: { node (registry entry), nodes (registry), common, state, failure }
export function buildBrief(step, { node, nodes, common = [], state, failure = '' }) {
  const artifactPaths = Object.entries(state.artifacts ?? {}).filter(([k, v]) => v && ['frontend', 'backend', 'media'].includes(k)).map(([k, v]) => `${k}: ${v}`);
  const buildIds = Object.keys(nodes).filter((id) => nodes[id].role === 'build');
  const plan = state.artifacts?.plan ?? '(not set)';
  const head = [
    `# ${node.label ?? step.node}: ${step.step_id}`,
    '',
    `Step: ${step.step_id}`,
    `Node: ${step.node}`,
    `Kind: ${step.kind}`,
    `Report file: ${step.expected_report}`,
    `Run: ${step.run} · iteration ${state.iteration} of ${state.max_iterations} · attempt ${step.attempt} of ${step.max_attempts}`,
    `Scope: ${step.scope}; allowed writes: ${step.allowed_writes.length ? step.allowed_writes.join(', ') : 'none'}`,
    ...(node.personaFile ? [`You are acting as the ${node.label} agent (${node.personaFile}).`] : []),
    ...(failure ? ['', `The previous attempt gave no usable result: ${failure}`] : []),
    '',
    '## Task',
    '',
  ];
  let body;
  let extra = [];
  switch (step.kind) {
    case 'plan': {
      const rejected = openBlocking(state.findings ?? []).filter((f) => f.node === 'architect');
      const optional = Object.keys(nodes).filter((id) => nodes[id].optional && nodes[id].role === 'build');
      body = [
        `Goal (verbatim): ${JSON.stringify(state.goal)}`,
        ...(rejected.length ? ['', 'The previous plan was rejected. Address each point:', list(rejected.map(describe))] : []),
        '',
        'Turn the goal into a system plan with an explicit capability map (module boundaries, dependency direction, build order).',
        'Create the plan from the matching plan-canvas template: run `aos-plan-canvas templates`, pick the template whose `useWhen` matches this goal, then `aos-plan-canvas new <template-id> production_artifacts/plan` and fill in the copied `plan.mdx` in place. On a revision round, or when `production_artifacts/plan/plan.mdx` exists, edit it in place and do not create a new folder. If the plan-canvas CLI is unavailable, write `production_artifacts/00_execution_plan.md` instead.',
        'Author the architecture as Archify JSON in `production_artifacts/00_architecture.json`; run `aos-archify validate architecture production_artifacts/00_architecture.json --quality showcase --json` while repairing and `aos-archify deliver architecture production_artifacts/00_architecture.json production_artifacts/00_architecture.html --quality showcase --json` once for final acceptance; link the HTML from the plan with a `url: production_artifacts/00_architecture.html` line. Report `artifacts.architecture` only after a passing showcase receipt (9 of 9 checks, 0 errors); on failure keep the previous HTML and say so in a finding.',
        ...(optional.length ? [`Decide whether the goal needs an optional build node (${optional.map((id) => `${id}: ${nodes[id].label}`).join('; ')}). List the ones you need in \`optional_nodes\`; most goals need none.`] : []),
      ].join('\n');
      extra = ['- `artifacts.plan` (required): the path of the plan file. `artifacts.architecture`: the delivered HTML, only after a passing receipt.', '- `optional_nodes`: array of optional node ids this plan needs (default none).'];
      break;
    }
    case 'techlead': {
      body = [
        `Read the plan at ${plan}. Approve it only if it has an explicit capability map: module boundaries, dependency direction and build order are all stated, not implicit.`,
        'Apply the architecture gate: reject unless `production_artifacts/00_architecture.json` and `production_artifacts/00_architecture.html` both exist, the plan links the diagram with a `url: production_artifacts/00_architecture.html` line, and the deliver receipt was a passing showcase receipt (9 of 9 checks, 0 errors).',
        '',
        'Approve: report status "ok" with no open blocking finding. Reject: report status "ok" with one blocking finding per reason (`node` "architect", `severity` "blocking", `status` "open", the reason as `summary`).',
      ].join('\n');
      break;
    }
    case 'human': {
      body = [
        `Open the plan in the plan canvas and wait for the human verdict: \`aos-plan-canvas open ${plan} --await\`. Never approve on the human's behalf.`,
        '',
        '- Approved: report status "ok".',
        '- Changes requested: report status "fail" with one blocking finding (`node` "architect", `status` "open", the feedback text as `summary`).',
        '- No verdict will come (session ended, timeout, CLI missing): report status "escalate".',
      ].join('\n');
      break;
    }
    case 'build': {
      const mine = openBlocking(state.findings ?? []).filter((f) => f.node === step.node);
      body = [
        `Read the plan at ${plan}.`,
        node.instructions ?? `Implement your part of the plan and write the ${node.artifactKey ?? step.node} artifact.`,
        ...(mine.length ? ['', 'Address these open Reviewer findings before anything else:', list(mine.map(describe))] : []),
        ...(step.round?.reason === 'gate-fix' ? ['', `Shipping's quality gate failed on a check you own: ${JSON.stringify(state.gate)}. Read production_artifacts/04_release_report.md for details and fix it.`] : []),
      ].join('\n');
      extra = [`- \`artifacts.${node.artifactKey ?? step.node}\` (required): the path of the artifact you wrote. Report a finding you fixed again with the same id and status "fixed".`];
      break;
    }
    case 'review': {
      const before = state.findings ?? [];
      body = [
        `Read the plan/contract at ${plan} and the artifacts it produced${artifactPaths.length ? ` (${artifactPaths.join('; ')})` : ''}, and the actual code. You get no goal; do not read \`production_artifacts/state.json\`, \`production_artifacts/runs/\` or any claim or reasoning of another node.`,
        'Find what is wrong with the artifact against its contract. Assume the author is overconfident. Do NOT validate. Do NOT summarize.',
        `Classify every finding by precedence: contract misread > valid and actionable (blocking) > valid trade-off (advisory) > noise (discard). Each finding names the build node that owns the fix: ${quoted(buildIds)}; no other value is valid.`,
        'Reuse the exact `id` of an issue that is still present and unfixed from the previous review; mint a new id only for a new issue. The dispatcher detects a repair round without progress by these ids.',
        ...(before.length ? ['', 'Previous review:', list(before.map((f) => `${describe(f)} [${f.severity}, ${f.status}]`))] : []),
        '',
        'Write `production_artifacts/review_findings.md` and report every finding of this review (an issue that is gone is simply left out).',
      ].join('\n');
      break;
    }
    case 'ship': {
      body = [
        `Run the automated quality gate against the artifacts of the plan at ${plan}: ${GATE_KEYS.join(', ')}.`,
        "Use the repository's own commands (npm test, pytest, tsc --noEmit and so on: detect which apply). Use \"skip\" only for a check that genuinely does not apply to this repo, not for one you did not run.",
        'Write `production_artifacts/04_release_report.md`. Do not push, publish or bump a version.',
      ].join('\n');
      extra = [
        `- \`gate\` (required): an object with exactly the keys ${GATE_KEYS.join(', ')}, each "pass", "fail" or "skip".`,
        `- For every failing check add a blocking finding (\`id\` "gate-<key>", \`status\` "open") whose \`node\` is the build node that owns the fix (${quoted(buildIds)}); the loop re-runs exactly those nodes.`,
      ];
      break;
    }
    default:
      body = 'Unknown step kind: report status "escalate".';
  }
  const skills = skillsNote(node, common, state.mandatory_skills ?? [], step);
  return [`${head.join('\n')}\n${body}`, skills, reportContract(step, extra)].filter(Boolean).join('\n\n') + '\n';
}
