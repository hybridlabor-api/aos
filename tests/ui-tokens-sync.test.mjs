import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

test('the agenttrail copy of the shared token stylesheet matches lib/ui-tokens', () => {
  assert.equal(at('../skills/global_config/agenttrail/public/shared/aos-tokens.css'), at('../lib/ui-tokens/aos-tokens.css'));
});
