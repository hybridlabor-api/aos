import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateSchema } from './validate.mjs';

/**
 * Computes SHA-256 hash of a file.
 * @param {string} filePath - Absolute or relative file path
 * @returns {string} Hexadecimal SHA-256 hash
 */
export function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Loads and validates a probe from its directory, verifying checker checksums.
 * 
 * @param {string} probeDir - Path to probe directory containing probe.json, fixture/, check.mjs, etc.
 * @returns {object} { ok: boolean, probe?: object, probeDir?: string, checkerPath?: string, expectedPath?: string, fixtureDir?: string, error?: string }
 */
export function loadProbe(probeDir) {
  const resolvedDir = path.resolve(probeDir);

  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Probe directory does not exist: ${resolvedDir}`);
  }

  const probeJsonPath = path.join(resolvedDir, 'probe.json');
  if (!fs.existsSync(probeJsonPath)) {
    throw new Error(`probe.json not found in probe directory: ${resolvedDir}`);
  }

  let probeData;
  try {
    const raw = fs.readFileSync(probeJsonPath, 'utf8');
    probeData = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse probe.json in ${resolvedDir}: ${err.message}`);
  }

  // Schema validation
  const validation = validateSchema('probe', probeData);
  if (!validation.valid) {
    throw new Error(`probe.json failed schema validation: ${validation.errors.join('; ')}`);
  }

  // Validate checker file existence
  const checkerName = probeData.checker || 'check.mjs';
  const checkerPath = path.join(resolvedDir, checkerName);
  if (!fs.existsSync(checkerPath)) {
    throw new Error(`Checker script '${checkerName}' not found in probe directory: ${resolvedDir}`);
  }

  // Checksum validation for checker
  const expectedCheckerSha = probeData.checker_sha256 || probeData.checksums?.[checkerName];
  if (expectedCheckerSha) {
    const actualCheckerSha = computeFileSha256(checkerPath);
    if (actualCheckerSha !== expectedCheckerSha) {
      throw new Error(
        `Checksum mismatch for checker '${checkerName}': expected ${expectedCheckerSha}, got ${actualCheckerSha}`
      );
    }
  }

  // Validate expected output file if specified
  const expectedName = probeData.expected || 'expected.json';
  const expectedPath = path.join(resolvedDir, expectedName);
  if (fs.existsSync(expectedPath)) {
    const expectedExpectedSha = probeData.expected_sha256 || probeData.checksums?.[expectedName];
    if (expectedExpectedSha) {
      const actualExpectedSha = computeFileSha256(expectedPath);
      if (actualExpectedSha !== expectedExpectedSha) {
        throw new Error(
          `Checksum mismatch for expected file '${expectedName}': expected ${expectedExpectedSha}, got ${actualExpectedSha}`
        );
      }
    }
  }

  // Fixture directory check
  const fixtureDir = path.join(resolvedDir, 'fixture');

  return {
    ok: true,
    probe: probeData,
    probeDir: resolvedDir,
    checkerPath,
    expectedPath: fs.existsSync(expectedPath) ? expectedPath : null,
    fixtureDir: fs.existsSync(fixtureDir) ? fixtureDir : null,
  };
}

export default {
  loadProbe,
  computeFileSha256,
};
