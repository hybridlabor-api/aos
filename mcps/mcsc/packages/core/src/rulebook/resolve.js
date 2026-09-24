/**
 * PURE function: routing decision implementing the Rulebook §3 Decision logic
 * and the §6 fallback/degradation contract.
 *
 * Synchronous, side-effect free, no Date.now() inside — the `attemptTrace`
 * records resolutions but never calls `Date.now()` at the top level; the TTL
 * check inside uses the offered `resolvedAt` timestamps only.
 *
 * @param {Object} taskDescriptor - { task_type: string, complexity?: string }
 * @param {import('./rulebook.types.js').Rule[]} rules - Merged rule list from loadRulebook()
 * @param {import('./rulebook.types.js').InventorySnapshot} inventorySnapshot - CLI health snapshot
 * @param {import('./rulebook.types.js').OfferTable} offerTable - Model offer registry per CLI per rule
 * @returns {import('./rulebook.types.js').Decision} Route or refuse decision
 */
export function decide(taskDescriptor, rules, inventorySnapshot, offerTable, now) {
  // Step 0: Find the first rule whose match criteria the taskDescriptor satisfies
  const matchingRule = rules.find(rule => matchesMatch(rule.match, taskDescriptor));

  if (!matchingRule) {
    return {
      kind: 'refuse',
      reason: 'no matching rule for task descriptor',
      attempted: []
    };
  }

  const candidates = matchingRule.candidates;
  const attemptTrace = [];
  const taskTier = inferTier(taskDescriptor, matchingRule);

  // --- Helper: find offer for a CLI within this rule ---
  function findOffer(cliId) {
    const ruleOffers = offerTable[cliId]?.[matchingRule.id];
    if (!ruleOffers) return null;
    return ruleOffers;
  }

  // --- Step 1: Preferred CLI, live registry offer ---
  // The "preferred CLI" is the first candidate in the rule's chain that is not 'native'
  const preferredCandidate = candidates.find(c => c.cli !== 'native');
  const preferredCliId = preferredCandidate ? preferredCandidate.cli : null;

  if (preferredCliId) {
    const cliHealth = inventorySnapshot.cliHealth?.[preferredCliId];
    if (cliHealth && (cliHealth.status === 'ready' || cliHealth.status === 'degraded')) {
      const offer = findOffer(preferredCliId);

      // Step 1: Preferred CLI has a live registry offer
      if (offer && offer.source === 'live-list') {
        return {
          kind: 'route',
          cliId: preferredCliId,
          offer: {
            cliId: preferredCliId,
            modelId: offer.modelId,
            tier: offer.tier,
            resolvedAt: offer.resolvedAt,
            source: offer.source
          },
          degraded: cliHealth.status === 'degraded' ? ['cli-degraded'] : []
        };
      }

      // Step 2: Preferred CLI, cached offer ≤ TTL
      if (offer && offer.source !== 'live-list') {
        const ttlMs = preferredCliId === 'opencode' ? 3_600_000 : 86_400_000; // 1h vs 24h
        if (offer.resolvedAt != null && (now - offer.resolvedAt) <= ttlMs) {
          return {
            kind: 'route',
            cliId: preferredCliId,
            offer: {
              cliId: preferredCliId,
              modelId: offer.modelId,
              tier: offer.tier,
              resolvedAt: offer.resolvedAt,
              source: offer.source
            },
            degraded: ['stale-offer']
          };
        }
      }
    }
  }

  // --- Steps 3 & 4: Fallback to other CLIs ---
  // Identify non-native candidates in their declared order
  const nonNativeCandidates = candidates.filter(c => c.cli !== 'native');

  const checkedNonNative = new Set();
  if (preferredCliId) checkedNonNative.add(preferredCliId);

  // Step 3: Next CLI in the rule's candidates order, same tier
  // Try each subsequent non-native candidate after the preferred one
  // Skip index 0 (the preferred CLI already checked in steps 1-2)
  for (let i = 1; i < nonNativeCandidates.length; i += 1) {
    const cliId = nonNativeCandidates[i].cli;
    const cliHealth = inventorySnapshot.cliHealth?.[cliId];

    if (!cliHealth || cliHealth.status !== 'ready') {
      attemptTrace.push({
        step: `step3-${i}`,
        cli: cliId,
        reason: cliHealth?.status === 'unusable' ? 'cli-unusable' : 'cli-absent',
        offered: false
      });
      checkedNonNative.add(cliId);
      continue;
    }

    const offer = findOffer(cliId);
    if (offer && offer.tier === taskTier) {
      // Step 3: Next CLI in the rule's candidates order, same tier
      return {
        kind: 'route',
        cliId,
        offer: {
          cliId,
          modelId: offer.modelId,
          tier: offer.tier,
          resolvedAt: offer.resolvedAt,
          source: offer.source
        },
        degraded: ['cli-substituted']
      };
    }

    attemptTrace.push({
      step: `step3-${i}`,
      cli: cliId,
      reason: 'tier-mismatch',
      offered: false
    });
    checkedNonNative.add(cliId);
  }

  // Step 4: Any healthy CLI at the same tier (outside preference chain)
  // Check all CLIs in the inventory, including those not in the candidate chain
  for (const [cliId, health] of Object.entries(inventorySnapshot.cliHealth || {})) {
    if (health.status !== 'ready' || cliId === 'native' || checkedNonNative.has(cliId)) continue;
    checkedNonNative.add(cliId);

    const offer = findOffer(cliId);
    if (offer && offer.tier === taskTier) {
      // Step 4: Any healthy CLI at the same tier, outside preference
      return {
        kind: 'route',
        cliId,
        offer: {
          cliId,
          modelId: offer.modelId,
          tier: offer.tier,
          resolvedAt: offer.resolvedAt,
          source: offer.source
        },
        degraded: ['cli-substituted', 'outside-preference']
      };
    }

    attemptTrace.push({
      step: `step4-${cliId}`,
      cli: cliId,
      reason: 'tier-mismatch',
      offered: false
    });
  }

  // --- Step 5: Tier downgrade (if fail-open policy) ---
  const rulePolicy = matchingRule.policy || (matchingRule.id === 'media-generation' ? 'fail-open' : 'fail-closed');
  if (rulePolicy === 'fail-open') {
    // Deterministic downgrade target: use 'quick-review' as the fallback tier
    const downgradeTier = taskTier === 'complex-code' ? 'quick-review' : taskTier;
    return {
      kind: 'route',
      cliId: 'native',
      offer: {
        cliId: 'native',
        modelId: 'native',
        tier: downgradeTier,
        resolvedAt: now,
        source: 'pinned'
      },
      degraded: ['tier-downgraded']
    };
  }

  // --- Step 6: Otherwise refuse ---
  return {
    kind: 'refuse',
    reason: 'no suitable CLI available after full fallback chain',
    attempted: attemptTrace
  };
}

/**
 * Infer the task tier from the taskDescriptor and rule match criteria.
 */
function inferTier(taskDescriptor, rule) {
  const { task_type, complexity } = taskDescriptor;
  const { task_type: ruleTaskTypes, min_complexity } = rule.match;

  if (ruleTaskTypes && Array.isArray(ruleTaskTypes) && ruleTaskTypes.includes(task_type)) {
    return task_type;
  }

  if (min_complexity && complexity) {
    return complexity;
  }

  // Default: media-generation falls to quick-review; others default quick-review too
  return 'quick-review';
}

/**
 * Check whether a taskDescriptor satisfies a rule's match criteria.
 */
function matchesMatch(matchCriteria, taskDescriptor) {
  if (!matchCriteria.task_type) return true;

  const descriptorTaskTypes = taskDescriptor.task_type;
  const ruleTaskTypes = matchCriteria.task_type;

  if (!Array.isArray(ruleTaskTypes)) {
    return ruleTaskTypes === descriptorTaskTypes;
  }

  return ruleTaskTypes.some(rt => descriptorTaskTypes.includes(rt));
}