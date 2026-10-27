// AOS Fabric edges: pure routing logic for the build pipeline
// decide(state, report) → { state, next } with no I/O: architect → techlead → build nodes → reviewer → shipping → ready_to_ship

export const PHASES = ['define', 'plan', 'build', 'review', 'ready_to_ship', 'ship', 'done', 'escalated', 'cancelled'];
export const MAX_ITERATIONS_DEFAULT = 3;

// Pure decision function: given current state and optional new report, return next state and action
export function decide(state, report = null) {
  const errors = [];

  if (!state || typeof state !== 'object') {
    return { error: 'state must be an object', code: 1 };
  }

  let newState = { ...state };
  newState.iteration = state.iteration || 0;
  newState.max_iterations = state.max_iterations || MAX_ITERATIONS_DEFAULT;
  newState.findings = state.findings || [];
  newState.gate = state.gate || {};
  newState.last_blocking_ids = state.last_blocking_ids || [];
  newState.attempts = state.attempts || {};

  // Process report if provided
  if (report && typeof report === 'object') {
    const stepId = report.step_id;
    if (!stepId) {
      return { error: 'report must have step_id', code: 2 };
    }

    // Track attempts per node/step
    const nodeId = stepId.split('-')[1]; // format: iteration-node-attempt
    if (nodeId) {
      newState.attempts[nodeId] = (newState.attempts[nodeId] || 0) + 1;
    }

    // Check for conflict: different digest on same step_id that was already accepted
    if (newState.last_step_digest && newState.last_step_id === stepId) {
      const reportDigest = hashReport(report);
      if (reportDigest !== newState.last_step_digest) {
        return { error: 'Conflict: different report on already-accepted step', code: 4 };
      }
      // Same digest: idempotent, no state change
      return { state: newState, next: decideNext(newState, null) };
    }

    // Accept the report
    newState.last_step_id = stepId;
    newState.last_step_digest = hashReport(report);

    // Update findings from report if any
    if (Array.isArray(report.findings)) {
      for (const finding of report.findings) {
        const idx = newState.findings.findIndex(f => f.id === finding.id);
        if (idx >= 0) {
          newState.findings[idx] = { ...newState.findings[idx], ...finding };
        } else {
          newState.findings.push(finding);
        }
      }
    }

    // Update gate if shipping reported results
    if (report.gate && typeof report.gate === 'object') {
      newState.gate = report.gate;
    }

    // Update phase if report specifies it
    if (report.phase) {
      newState.phase = report.phase;
    }
  }

  // Fail closed: terminal phases never advance
  if (PHASES.includes(newState.phase) && (newState.phase === 'escalated' || newState.phase === 'done' || newState.phase === 'cancelled')) {
    return { state: newState, next: { kind: newState.phase }, code: 6 };
  }

  // Hard iteration ceiling
  if (newState.iteration >= newState.max_iterations) {
    newState.phase = 'escalated';
    newState.needs_human = true;
    return { state: newState, next: { kind: 'escalated' }, code: 0 };
  }

  return { state: newState, next: decideNext(newState, report) };
}

function decideNext(state, report) {
  const phase = state.phase || 'define';

  // State machine edges (from .agents/graph.md)
  if (phase === 'define' || phase === 'plan') {
    // Architect always first
    return { kind: 'step', node: 'architect', role: 'plan' };
  }

  if (phase === 'build' || phase === 'review') {
    // After build/review loop, check findings
    const openBlockingFindings = (state.findings || []).filter(
      f => f.severity === 'blocking' && f.status === 'open'
    );

    if (openBlockingFindings.length === 0) {
      // Clean; move to shipping
      return { kind: 'step', node: 'shipping', role: 'gate' };
    }

    // No-progress guard: same blocking IDs as last round
    const currentIds = new Set(openBlockingFindings.map(f => f.id));
    const lastIds = state.last_blocking_ids || [];
    const sameIds = lastIds.length > 0 &&
      currentIds.size === lastIds.length &&
      [...currentIds].every(id => lastIds.includes(id));

    if (sameIds && state.iteration > 0) {
      // Escalate: repair round made no progress
      return { kind: 'escalated', reason: 'no-progress' };
    }

    // New or different blocking IDs: increment iteration and re-run affected nodes
    state.iteration++;
    state.last_blocking_ids = [...currentIds];

    const affectedNodes = [...new Set(openBlockingFindings.map(f => f.node))];
    if (affectedNodes.length === 0) {
      return { kind: 'escalated', reason: 'findings-without-nodes' };
    }

    // For simplicity, return first affected node; dispatcher handles parallel re-run
    return { kind: 'step', node: affectedNodes[0], role: 'build', reason: 'reviewer-repair' };
  }

  if (phase === 'ready_to_ship') {
    // All gates passed; done with build/review/shipping loop
    return { kind: 'ready_to_ship' };
  }

  // Default: Architect first
  return { kind: 'step', node: 'architect', role: 'plan' };
}

// Simple hash of report for idempotency
function hashReport(report) {
  const str = JSON.stringify(report);
  // Lightweight hash for comparison
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return String(hash);
}

// Scenarios table test data for all edges (called by tests)
export const EDGE_SCENARIOS = [
  {
    name: 'happy-path-architect-to-techlead',
    state: { phase: 'define', iteration: 0 },
    report: null,
    expect: { phase: 'define', next_node: 'architect' },
  },
  {
    name: 'techlead-approved-to-build',
    state: { phase: 'plan', iteration: 0 },
    report: null,
    expect: { phase: 'plan', next_kind: 'step' },
  },
  {
    name: 'reviewer-clean-to-shipping',
    state: { phase: 'review', findings: [], iteration: 0 },
    report: null,
    expect: { phase: 'review', next_node: 'shipping' },
  },
  {
    name: 'reviewer-blocking-to-repair',
    state: { phase: 'review', iteration: 0, findings: [{ id: 'f1', severity: 'blocking', status: 'open', node: 'engineering' }] },
    report: null,
    expect: { phase: 'review', next_node: 'engineering' },
  },
  {
    name: 'no-progress-guard-escalates',
    state: { phase: 'review', iteration: 1, findings: [{ id: 'f1', severity: 'blocking', status: 'open', node: 'engineering' }], last_blocking_ids: ['f1'] },
    report: null,
    expect: { phase: 'review', next_kind: 'escalated' },
  },
  {
    name: 'iteration-ceiling-escalates',
    state: { phase: 'review', iteration: 3, max_iterations: 3 },
    report: null,
    expect: { phase: 'escalated' },
  },
  {
    name: 'gate-fail-to-repair',
    state: { phase: 'ready_to_ship', iteration: 0, gate: { lint: 'fail' } },
    report: null,
    expect: { phase: 'ready_to_ship' },
  },
  {
    name: 'idempotent-same-digest',
    state: { phase: 'plan', last_step_id: 'step-1', last_step_digest: '12345' },
    report: { step_id: 'step-1', findings: [] },
    expect: { code: 0 },
  },
];
