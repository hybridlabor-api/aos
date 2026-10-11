/**
 * @typedef {Object} DelegationRequest
 * @property {string} taskType
 * @property {string} prompt
 * @property {string} model
 * @property {string} cwd
 * @property {boolean} [mcp] true keeps the worker's configured MCP servers; default false starts it without them (OpenCode only so far).
 * @property {string} [variant] Optional model variant (reasoning effort) passed to `opencode run --variant`.
 */

/**
 * @typedef {Object} DelegationResult
 * @property {number} exit
 * @property {string} output
 * @property {{
 *   kind: 'confirmed' | 'mismatch' | 'unavailable',
 *   modelId?: string,
 *   sessionRef?: string,
 *   requested?: string,
 *   actual?: string
 * }} attestation
 */