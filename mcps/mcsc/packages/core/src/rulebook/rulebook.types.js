/**
 * @typedef {Object} CliId
 * @type {string}
 * @readonly */
export const CliId = {
  AGY: 'agy',
  OPENCODE: 'opencode',
  CODEX: 'codex',
  NATIVE: 'native'
};

/** @readonly */ export const Tier = {
  DEEP_RESEARCH: 'deep-research',
  COMPLEX_CODE: 'complex-code',
  QUICK_REVIEW: 'quick-review',
  MEDIA_GENERATION: 'media-generation'
};

/**
 * @typedef {Object} ProbeResult
 * @property {boolean} pass
 * @property {string} evidence
 * @property {string} reason
 */

/**
 * @typedef {Object} CliHealth
 * @property {('ready'|'degraded'|'unusable'|'absent')} status
 * @property {string} binary
 * @property {string} version
 * @property {ProbeResult[]} probes
 */

/**
 * @typedef {Object} ModelOffer
 * @property {string} cliId
 * @property {string} modelId
 * @property {string} tier
 * @property {string} resolvedAt
 * @property {'live-list'|'pinned'|'stale-cache'} source
 */

/** @typedef {('stale-offer'|'cli-substituted'|'outside-preference'|'tier-downgraded')} DegradationNote */

/**
 * @typedef {Object} AttemptTrace
 * @property {number} step
 * @property {string} cli
 * @property {string} reason
 * @property {boolean} offered
 */

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {Object} match - { task_type: string[], min_complexity?: string }
 * @property {Array<{cli: string, model?: string, model_select?: Object}>} candidates
 * @property {('fail-open'|'fail-closed')} policy
 */

/**
 * @typedef {Object} InventorySnapshot
 * @property {{[cliId: string]: CliHealth}} cliHealth
 */

/**
 * @typedef {Object} OfferTableEntry
 * @property {string} modelId
 * @property {string} tier
 * @property {string} resolvedAt
 * @property {'live-list'|'pinned'|'stale-cache'} source
 */

/**
 * @typedef {Object} OfferTable
 * @property {{[ruleId: string]: OfferTableEntry}} [ruleId]
 * @property {{[cliId: string]: OfferTableEntry}} [cliId]
 */

/**
 * @typedef {Object} Decision
 * @property {('route'|'refuse')} kind
 * @property {string} kind
 * @property {string} cliId
 * @property {ModelOffer} offer
 * @property {DegradationNote[]} degraded
 * @property {string} reason
 * @property {AttemptTrace[]} attempted
 */