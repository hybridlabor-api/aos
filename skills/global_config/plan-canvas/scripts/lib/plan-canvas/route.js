'use strict';

function routeFor(item, { planHasComponents = false } = {}) {
  if (!item || typeof item !== 'object') return 'artifact';
  if (item.kind === 'annotation' && item.target && item.target.origin === 'app') return 'visual-edit';
  if (item.kind === 'verdict' && item.verdict === 'approve' && planHasComponents) return 'build';
  return 'artifact';
}

module.exports = { routeFor };
