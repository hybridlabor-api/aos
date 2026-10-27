function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

export function deduplicateFindings(allFindings) {
  const seen = new Map();
  const result = [];

  for (const f of allFindings) {
    const key = `${f.file || ''}:${f.line || ''}:${normalizeTitle(f.summary || '')}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      // Upgrade severity if this finding is blocking and the existing is not
      if (f.severity === 'blocking' && existing.severity !== 'blocking') {
        existing.severity = 'blocking';
      }
      // Collect sources (reviewer agent IDs)
      const sources = new Set(existing.sources || []);
      if (f.agent) sources.add(f.agent);
      existing.sources = Array.from(sources);
    } else {
      const entry = { ...f };
      entry.sources = f.agent ? [f.agent] : [];
      seen.set(key, entry);
      result.push(entry);
    }
  }
  return result;
}

export function mergeFindings(allFindings, parallelReviewers = []) {
  const deduped = deduplicateFindings(allFindings);
  
  const result = [];
  const reviewerMap = {};
  
  // Build a map of reviewer index by ID for sources field
  parallelReviewers.forEach((id, idx) => {
    reviewerMap[id] = idx;
  });

  for (const f of deduped) {
    const merged = { ...f };
    
    // Map sources to reviewer indices if parallelReviewers provided
    if (f.sources && parallelReviewers.length > 0) {
      merged.sources = f.sources
        .map((src) => {
          // Try to match reviewer ID
          if (reviewerMap.hasOwnProperty(src)) {
            return src;
          }
          return src;
        })
        .filter(Boolean);
    }

    // Ensure status is valid
    if (!['open', 'fixed', 'wont_fix'].includes(merged.status)) {
      merged.status = 'open';
    }

    result.push(merged);
  }

  return result;
}

export function normalizeComparisonKey(finding) {
  if (!finding || typeof finding !== 'object') return '';
  const nodeKey = finding.node || '';
  const titleKey = normalizeTitle(finding.summary || '');
  return `${nodeKey}:${titleKey}`;
}

export function checkNoProgress(currentFindings, previousBlockingKeys) {
  const currentKeys = new Set();

  for (const f of currentFindings) {
    if (f.severity === 'blocking' && f.status === 'open') {
      currentKeys.add(normalizeComparisonKey(f));
    }
  }

  // No progress if the same normalized findings are still open (node + title)
  const sameByKeys =
    currentKeys.size > 0 &&
    currentKeys.size === previousBlockingKeys.size &&
    [...currentKeys].every((key) => previousBlockingKeys.has(key));

  return sameByKeys;
}
