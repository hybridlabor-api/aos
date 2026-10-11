'use strict';
// Shared by installer.js (compilers) and bin/aos-doctor.mjs. Format checks only: no provider
// lists, no network. See docs/agent-models.md.
const HARNESSES = ['claude', 'codex', 'opencode', 'antigravity'];
const AGY_DOCUMENTED = ['inherit', 'flash', 'pro'];

// Returns a problem description, or null when the value is usable for that harness.
// strictAgy: also require one of the values agy documents (the doctor does; the compilers pass
// the string through because agy may add ids).
function modelProblem(harness, value, { strictAgy = false } = {}) {
    if (!HARNESSES.includes(harness)) return `unknown harness (use ${HARNESSES.join(', ')})`;
    if (typeof value !== 'string' || value === '') return 'must be a non-empty string';
    if (/\s/.test(value)) return 'must not contain whitespace or newlines';
    if (harness === 'opencode' && !/^[^/]+\/.+$/.test(value)) return 'must be provider/model without whitespace';
    if (harness === 'antigravity' && strictAgy && !AGY_DOCUMENTED.includes(value)) {
        return `agy documents only ${AGY_DOCUMENTED.join('|')} (see docs/agent-models.md); remove the line to inherit`;
    }
    return null;
}

module.exports = { HARNESSES, AGY_DOCUMENTED, modelProblem };
