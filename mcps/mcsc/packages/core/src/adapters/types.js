/**
 * @typedef {Object} DelegationRequest
 * @property {string} taskType
 * @property {string} prompt
 * @property {string} model
 * @property {string} cwd
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