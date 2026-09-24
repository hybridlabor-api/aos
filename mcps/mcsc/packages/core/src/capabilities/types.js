/**
 * @typedef {'agy' | 'opencode' | 'codex' | 'native'} CliId
 */

/**
 * @typedef {'deep-research' | 'complex-code' | 'quick-review' | 'media-generation'} Tier
 */

/**
 * @typedef {Object} ModelOffer
 * @property {CliId} cliId
 * @property {string} modelId
 * @property {Tier} tier
 * @property {number} resolvedAt
 * @property {'live-list' | 'pinned' | 'stale-cache'} source
 */

/**
 * @typedef {Object} CapabilityRegistryPort
 * @property {(cliId: CliId, tier: Tier, now: number) => Promise<ModelOffer | null>} resolveOffer
 * @property {(cliId: CliId) => Promise<void>} refresh
 */

export {};
