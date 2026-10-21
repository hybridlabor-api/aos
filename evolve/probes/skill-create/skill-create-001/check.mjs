#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const fixturePath = path.join(__dirname, 'fixture', 'sample-skill-spec.json');
  const expectedPath = path.join(__dirname, 'expected.json');

  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

  const validName = /^[a-z0-9_-]+$/.test(fixture.name);
  const nameMatches = fixture.name === expected.name;
  const descriptionWithinBudget = typeof fixture.description === 'string' && fixture.description.length <= expected.max_description_length;
  const hasSections = expected.required_sections.every(sec => fixture.required_sections?.includes(sec));

  const pass = validName && nameMatches && descriptionWithinBudget && hasSections;
  const score = pass ? 1.0 : 0.0;

  const result = {
    pass,
    score,
    notes: pass
      ? 'Skill specification satisfies naming, description budget, and section requirements.'
      : 'Skill specification failed validation.'
  };

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(pass ? 0 : 1);
} catch (err) {
  process.stdout.write(JSON.stringify({
    pass: false,
    score: 0,
    notes: `Checker error: ${err.message}`
  }, null, 2) + '\n');
  process.exit(1);
}
