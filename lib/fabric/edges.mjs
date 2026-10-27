// Edges of the fabric loop: the edge table of .agents/graph.md as one pure function. No I/O.
// decide(state, step, report, ctx) -> { state, next, reason? } where next is
//   { kind: 'step', node, attempt, round?, reason? } or { kind: 'escalated' | 'ready_to_ship' }.
// Sequence: architect -> techlead -> human -> build nodes -> reviewer -> shipping. A repair round runs only the nodes
// that own an open finding; a gate-fix round runs the nodes the Shipping findings name, then Shipping again.

import { stateFinding } from './schema.mjs';

export const MAX_ITERATIONS_DEFAULT = 3;
export const MAX_ATTEMPTS_DEFAULT = 2;
export const HUMAN_NODE = 'human';
export const REQUIRED_NODE_IDS = ['architect', 'techlead', 'ui_ux', 'engineering', 'media_eventtech', 'reviewer', 'shipping'];

const KIND_BY_ROLE = { plan: 'plan', approve: 'techlead', build: 'build', review: 'review', gate: 'ship' };
export const kindOf = (node, nodes) => (node === HUMAN_NODE ? 'human' : KIND_BY_ROLE[nodes?.[node]?.role]);

export function initialState({ run_id, goal, max_iterations = MAX_ITERATIONS_DEFAULT, mandatory_skills = [] }) {
  return {
    run_id, goal, phase: 'define', iteration: 0, max_iterations, gate: {}, findings: [], approvals: [],
    artifacts: {}, mandatory_skills, needs_human: false, attempts: {}, last_blocking_ids: [],
  };
}

export const firstNext = () => ({ kind: 'step', node: 'architect', attempt: 1 });

const isOpenBlocking = (f) => f.severity === 'blocking' && f.status === 'open';
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

export function decide(state, step, report, { nodes, maxAttempts = MAX_ATTEMPTS_DEFAULT }) {
  const s = structuredClone(state);
  s.attempts ??= {};
  s.last_blocking_ids ??= [];
  s.findings ??= [];
  s.artifacts ??= {};
  const node = step.node;
  const kind = step.kind;
  const key = `${s.iteration}-${node}`;
  s.attempts[key] = (s.attempts[key] ?? 0) + 1;
  const attempt = s.attempts[key];

  const issue = (n, extra = {}) => ({ state: s, next: { kind: 'step', node: n, attempt: (s.attempts[`${s.iteration}-${n}`] ?? 0) + 1, ...extra } });
  const escalate = (reason) => { s.phase = 'escalated'; s.needs_human = true; return { state: s, next: { kind: 'escalated' }, reason }; };
  // A repair edge: the iteration counter moves, and the ceiling stops the loop for good.
  const bump = (why) => {
    s.iteration += 1;
    return s.iteration >= s.max_iterations ? escalate(`${why}; the iteration limit of ${s.max_iterations} is reached`) : null;
  };
  const retry = (why) => (attempt < maxAttempts
    ? issue(node, { reason: 'retry', ...(step.round && { round: step.round }) })
    : escalate(`${node} gave no usable result in ${attempt} attempts: ${why}`));
  const merge = () => {
    Object.assign(s.artifacts, report.artifacts);
    for (const f of report.findings) {
      const i = s.findings.findIndex((x) => x.id === f.id);
      if (i >= 0) s.findings[i] = stateFinding({ ...s.findings[i], ...f });
      else s.findings.push(stateFinding(f));
    }
  };
  const buildRound = (onlyIds, reason) => {
    const ids = Object.keys(nodes).filter((id) => nodes[id].role === 'build'
      && (!nodes[id].optional || s.roles?.[id] === true) && (!onlyIds || onlyIds.includes(id)));
    if (ids.length === 0) return escalate('no build node resolved for this round');
    s.phase = 'build';
    return issue(ids[0], { round: { remaining: ids.slice(1), reason } });
  };
  const owners = (findings) => [...new Set(findings.filter(isOpenBlocking).map((f) => f.node))].filter((id) => nodes[id]?.role === 'build');
  // The plan came back with changes requested (TechLead or the human): Architect owns the fix.
  const planRejected = (open, who) => {
    s.findings = s.findings.filter((f) => f.node !== 'architect').concat(open.map((f) => stateFinding({ ...f, node: 'architect' })));
    s.phase = 'define';
    return bump(`${who} rejected the plan`) ?? issue('architect', { reason: 'plan-rejected' });
  };

  if (report.status === 'escalate' || report.needs_human) {
    const why = report.findings.find(isOpenBlocking)?.summary || `${node} asked for a human`;
    return escalate(why);
  }

  if (report.status === 'fail') {
    if (kind !== 'human') return retry(report.findings[0]?.summary || 'the step failed');
    const open = report.findings.filter(isOpenBlocking);
    return planRejected(open.length ? open : [{ id: `human-${step.step_id}`, severity: 'blocking', node: 'architect', status: 'open', summary: 'The human requested changes (no text given)' }], 'The human');
  }

  switch (kind) {
    case 'plan': {
      if (!report.artifacts.plan) return retry('no artifacts.plan path in the report');
      Object.assign(s.artifacts, report.artifacts);
      s.roles = { ...s.roles, ...Object.fromEntries((report.optional_nodes ?? []).filter((id) => nodes[id]?.optional).map((id) => [id, true])) };
      if (Object.keys(s.roles).length === 0) delete s.roles;
      s.phase = 'plan';
      return issue('techlead');
    }
    case 'techlead': {
      const open = report.findings.filter(isOpenBlocking);
      if (open.length) return planRejected(open, 'TechLead');
      s.findings = s.findings.map((f) => (f.node === 'architect' && f.status === 'open' ? { ...f, status: 'fixed' } : f));
      return issue(HUMAN_NODE);
    }
    case 'human':
      return buildRound(null, 'build');
    case 'build': {
      merge();
      const rest = step.round?.remaining ?? [];
      if (rest.length) return issue(rest[0], { round: { remaining: rest.slice(1), reason: step.round.reason } });
      if (step.round?.reason === 'gate-fix') { s.phase = 'verify'; return issue('shipping'); }
      s.phase = 'review';
      return issue('reviewer');
    }
    case 'review': {
      s.findings = report.findings.map(stateFinding);
      const blocking = s.findings.filter(isOpenBlocking);
      if (blocking.length === 0) { s.last_blocking_ids = []; s.phase = 'verify'; return issue('shipping'); }
      const ids = blocking.map((f) => f.id);
      if (s.iteration > 0 && sameSet(ids, s.last_blocking_ids)) {
        return escalate('No progress: the Reviewer reported the exact same blocking finding(s) after a repair round that was meant to fix them');
      }
      const own = owners(s.findings);
      if (own.length === 0) return escalate('The Reviewer reported blocking findings but none is owned by a build node');
      s.last_blocking_ids = ids;
      return bump('The Reviewer found blocking issues') ?? buildRound(own, 'repair');
    }
    case 'ship': {
      if (!report.gate) return retry('no gate results in the report');
      s.gate = { ...report.gate };
      const failing = Object.entries(s.gate).filter(([, v]) => v === 'fail').map(([k]) => k);
      if (failing.length === 0) { s.phase = 'ready_to_ship'; return { state: s, next: { kind: 'ready_to_ship' } }; }
      const own = owners(report.findings);
      const stop = bump(`The quality gate fails (${failing.join(', ')})`);
      if (stop) return stop;
      if (own.length === 0) return escalate(`The quality gate fails (${failing.join(', ')}) but Shipping named no owning build node`);
      return buildRound(own, 'gate-fix');
    }
    default:
      return escalate(`unknown step kind ${kind}`);
  }
}
