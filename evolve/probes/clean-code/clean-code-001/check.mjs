#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const fixturePath = path.join(__dirname, 'fixture', 'sample-code.js');
  const expectedPath = path.join(__dirname, 'expected.json');

  const code = fs.readFileSync(fixturePath, 'utf8');
  const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

  const lines = code.trim().split('\n');
  const withinLineLimit = lines.length <= expected.max_lines;
  const definesFunction = code.includes(`function ${expected.function_name}`);
  const hasValidation = /typeof price !== 'number'/.test(code);
  const hasConstants = expected.named_constants.every(constName => code.includes(constName));

  const pass = withinLineLimit && definesFunction && hasValidation && hasConstants;
  const score = pass ? 1.0 : 0.0;

  const result = {
    pass,
    score,
    notes: pass
      ? 'Code sample satisfies clean-code principles: single responsibility, input validation, and named constants.'
      : 'Code failed clean-code validation criteria.'
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
