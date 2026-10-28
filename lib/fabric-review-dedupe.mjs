const STATUSES = ['open', 'fixed', 'wont_fix'];

function normalizeTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .trim();
}

// Owning node plus normalized title (plus file and line when given): the identity of a finding across
// reviewers and across repair rounds. A finding without a title falls back to its id so that distinct
// untitled findings of one node never merge.
export function normalizeComparisonKey(finding) {
  if (!finding || typeof finding !== 'object') return '';
  const title = normalizeTitle(finding.summary || '') || String(finding.id || '');
  const where = finding.file || finding.line ? `:${finding.file || ''}:${finding.line || ''}` : '';
  return `${finding.node || ''}:${title}${where}`;
}

// A malformed report is read the worse way: a missing or unknown status counts as open, a missing or unknown severity as blocking.
const statusOf = (f) => (STATUSES.includes(f.status) ? f.status : 'open');
const severityOf = (f) => (f.severity === 'advisory' ? 'advisory' : 'blocking');

export function deduplicateFindings(allFindings) {
  const seen = new Map();
  const result = [];

  for (const f of allFindings) {
    const key = normalizeComparisonKey(f);
    const existing = seen.get(key);
    if (existing) {
      // A duplicate never hides a blocking or an open report.
      if (severityOf(f) === 'blocking') existing.severity = 'blocking';
      if (statusOf(f) === 'open') existing.status = 'open';
      if (f.agent && !existing.sources.includes(f.agent)) existing.sources.push(f.agent);
    } else {
      const entry = { ...f, severity: severityOf(f), status: statusOf(f), sources: f.agent ? [f.agent] : [] };
      seen.set(key, entry);
      result.push(entry);
    }
  }
  return result;
}
