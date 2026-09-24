/**
 * CliAdapter for 'native'.
 *
 * Native delegation happens at the orchestrator level (Agent tool),
 * not by shelling out. This adapter is a no-op that signals
 * unattested delegation — the orchestrator should handle the
 * native Claude Code subagent lifecycle itself.
 *
 * @param {import('../adapters/types.js').DelegationRequest} req
 * @returns {Promise<{ exit: number; output: string; attestation: { kind: 'unavailable'; } }>}
 */
export async function delegate(req) {
  throw new Error("Task requires native handling by the current orchestrator. Do not use delegate tools for this.");
}