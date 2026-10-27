const STATUSES = ['open', 'fixed', 'wont_fix'];

function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

// Node plus normalized title: the identity of a finding across reviewers and across repair rounds.
export function normalizeComparisonKey(finding) {
  if (!finding || typeof finding !== 'object') return '';
  return `${finding.node || ''}:${normalizeTitle(finding.summary || '')}`;
}

// A missing or unknown status counts as open: a malformed report must never read as resolved.
const statusOf = (f) => (STATUSES.includes(f.status) ? f.status : 'open');

export function deduplicateFindings(allFindings) {
  const seen = new Map();
  const result = [];

  for (const f of allFindings) {
    const key = `${normalizeComparisonKey(f)}:${f.file || ''}:${f.line || ''}`;
    const existing = seen.get(key);
    if (existing) {
      // A duplicate never hides a blocking or an open report.
      if (f.severity === 'blocking') existing.severity = 'blocking';
      if (statusOf(f) === 'open') existing.status = 'open';
      if (f.agent && !existing.sources.includes(f.agent)) existing.sources.push(f.agent);
    } else {
      const entry = { ...f, status: statusOf(f), sources: f.agent ? [f.agent] : [] };
      seen.set(key, entry);
      result.push(entry);
    }
  }
  return result;
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
