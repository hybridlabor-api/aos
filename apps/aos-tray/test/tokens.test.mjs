import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The app bundles a copy of the shared tokens (frontendDist cannot reach lib/); keep it identical.
test('ui/aos-tokens.css matches lib/ui-tokens/aos-tokens.css', () => {
  const norm = (u) => readFileSync(new URL(u, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(norm('../ui/aos-tokens.css'), norm('../../../lib/ui-tokens/aos-tokens.css'));
});
