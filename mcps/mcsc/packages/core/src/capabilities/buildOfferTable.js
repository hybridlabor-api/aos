import { resolveOffer } from './registry.js';

/**
 * @param {Array<any>} rules
 * @param {Map<import('./types.js').CliId, any>} inventorySnapshot
 * @param {number} now
 * @returns {Promise<Object>} offerTable
 */
export async function buildOfferTable(rules, inventorySnapshot, now) {
  const offerTable = {};

  for (const rule of rules) {
    if (!rule.candidates) continue;
    const tier = rule.id;

    for (const candidate of rule.candidates) {
      const cliId = candidate.cli;
      if (cliId === 'native') continue;

      const health = inventorySnapshot.get(cliId);
      if (!health || (health.status !== 'ready' && health.status !== 'degraded')) continue;

      const offer = await resolveOffer(cliId, tier, now);
      if (offer) {
        if (!offerTable[cliId]) {
          offerTable[cliId] = {};
        }
        offerTable[cliId][rule.id] = offer;
      }
    }
  }

  return offerTable;
}
