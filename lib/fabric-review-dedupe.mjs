export function deduplicateFindings(allFindings) {
  const seen = new Map();
  const result = [];
  for (const f of allFindings) {
    const key = `${f.file || ''}:${f.line || ''}:${(f.summary || '').slice(0, 60)}`;
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (f.severity === 'blocking' && existing.severity !== 'blocking') {
        existing.severity = 'blocking';
      }
      const sources = new Set(existing.sources || [existing.agent || existing.node || 'unknown']);
      sources.add(f.agent || f.node || 'unknown');
      existing.sources = Array.from(sources);
    } else {
      const entry = { ...f };
      entry.sources = [f.agent || f.node || 'unknown'];
      seen.set(key, entry);
      result.push(entry);
    }
  }
  return result;
}
