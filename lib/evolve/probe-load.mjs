import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateSchema } from './validate.mjs';

export function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function loadPins(pinsFilePath) {
  const defaultPath = path.resolve(process.cwd(), 'evolve', 'pins.json');
  const targetPath = pinsFilePath ? path.resolve(pinsFilePath) : defaultPath;

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Pins file not found: ${targetPath}`);
  }

  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const data = JSON.parse(raw);
    return data.pins || {};
  } catch (err) {
    throw new Error(`Failed to read pins file '${targetPath}': ${err.message}`);
  }
}

export function loadProbe(probeDir, opts = {}) {
  const resolvedDir = path.resolve(probeDir);

  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Probe directory does not exist: ${resolvedDir}`);
  }

  const realProbeDir = fs.realpathSync(resolvedDir);
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

  const validation = validateSchema('probe', probeData);
  if (!validation.valid) {
    throw new Error(`probe.json failed schema validation: ${validation.errors.join('; ')}`);
  }

  const checkerName = probeData.checker || 'check.mjs';

  // Enforce checker is strictly a basename (review finding 6)
  if (path.basename(checkerName) !== checkerName || checkerName.includes('/') || checkerName.includes('\\')) {
    throw new Error(`Checker '${checkerName}' must be a basename without path separators`);
  }

  const checkerPath = path.join(resolvedDir, checkerName);
  if (!fs.existsSync(checkerPath)) {
    throw new Error(`Checker script '${checkerName}' not found in probe directory: ${resolvedDir}`);
  }

  // Ensure realpath stays inside probe directory
  const realCheckerPath = fs.realpathSync(checkerPath);
  if (!realCheckerPath.startsWith(realProbeDir + path.sep)) {
    throw new Error(`Checker path '${checkerName}' escapes probe directory`);
  }

  // Load centralized pins (review finding 8)
  const allPins = opts.pins || loadPins(opts.pinsPath);
  const probePins = allPins[probeData.id];

  if (!probePins) {
    // Fail closed if probe pin entry is missing (review finding 7)
    throw new Error(`Missing checksum pins for probe '${probeData.id}' in evolve/pins.json (fail closed)`);
  }

  const expectedCheckerSha = probePins[checkerName] || probePins.checker_sha256;
  if (!expectedCheckerSha) {
    // Fail closed if checker pin is missing
    throw new Error(`Missing checksum pin for checker '${checkerName}' in probe '${probeData.id}' (fail closed)`);
  }

  const actualCheckerSha = computeFileSha256(realCheckerPath);
  if (actualCheckerSha !== expectedCheckerSha) {
    throw new Error(
      `Checksum mismatch for checker '${checkerName}': expected ${expectedCheckerSha}, got ${actualCheckerSha}`
    );
  }

  let expectedPath = null;
  const expectedName = probeData.expected || 'expected.json';
  const rawExpectedPath = path.join(resolvedDir, expectedName);

  if (fs.existsSync(rawExpectedPath)) {
    // Enforce expected is strictly a basename
    if (path.basename(expectedName) !== expectedName || expectedName.includes('/') || expectedName.includes('\\')) {
      throw new Error(`Expected file '${expectedName}' must be a basename without path separators`);
    }

    const realExpectedPath = fs.realpathSync(rawExpectedPath);
    if (!realExpectedPath.startsWith(realProbeDir + path.sep)) {
      throw new Error(`Expected path '${expectedName}' escapes probe directory`);
    }

    expectedPath = realExpectedPath;
    const expectedExpectedSha = probePins[expectedName] || probePins.expected_sha256;
    if (!expectedExpectedSha) {
      throw new Error(`Missing checksum pin for expected file '${expectedName}' in probe '${probeData.id}' (fail closed)`);
    }

    const actualExpectedSha = computeFileSha256(realExpectedPath);
    if (actualExpectedSha !== expectedExpectedSha) {
      throw new Error(
        `Checksum mismatch for expected file '${expectedName}': expected ${expectedExpectedSha}, got ${actualExpectedSha}`
      );
    }
  }

  const fixtureDir = path.join(resolvedDir, 'fixture');

  return {
    ok: true,
    probe: probeData,
    probeDir: resolvedDir,
    checkerPath: realCheckerPath,
    expectedPath,
    fixtureDir: fs.existsSync(fixtureDir) ? fixtureDir : null,
  };
}

export default {
  loadProbe,
  loadPins,
  computeFileSha256,
};
