import { probes } from './probes.js';
// CliHealth is a JSDoc-only typedef in ./types.js — reference it via
// `@typedef {import('./types.js').CliHealth} CliHealth` in comments, never
// as a real import (there is nothing to import at runtime).
import { execFile as execFileCb } from 'node:child_process';
import { stat, readFile } from 'node:fs/promises';

/** @param {{cliIds: string[], maxAgeMs: number}} opts */
export const runInventory = async ({ cliIds, maxAgeMs }) => {
  const cliHealthMap = new Map();

  const sh = {
    cliId: '',
    execFile: (cmd, args, options) =>
      new Promise((resolve, reject) => {
        execFileCb(cmd, args, options, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
      }),
    stat: (p) => stat(p).then((s) => ({ mtime: s.mtimeMs })),
    readFile: (p) => readFile(p, 'utf8'),
  };

  for (const cliId of cliIds) {
    sh.cliId = cliId;
    const cliProbes = probes.filter((p) => p.cliId === cliId);
    const probesResults = [];

    for (const probe of cliProbes) {
      try {
        const result = await probe.run(sh);
        probesResults.push(result.pass ? { pass: true } : { pass: false, evidence: result.evidence, reason: result.reason });
      } catch (e) {
        probesResults.push({ pass: false, evidence: e.message, reason: 'probe-error' });
      }
    }

    const allPass = probesResults.every((r) => r.pass);
    const hasUnusable = probesResults.some(
      (r) => r.reason === 'not-on-path' || r.reason === 'unauthenticated' || r.reason === 'permissions' || r.reason === 'hangs' || r.reason === 'version-unsupported'
    );

    let status, binary, version, reason;

    if (allPass) {
      status = 'ready';
      binary = 'resolved';
      version = 'detected';
    } else if (hasUnusable) {
      status = 'unusable';
      const unusableReason = probesResults.find(
        (r) => r.reason && ['not-on-path', 'unauthenticated', 'permissions', 'hangs', 'version-unsupported'].includes(r.reason)
      )?.reason || 'unknown';
      reason = unusableReason;
      // 'missing' only when the binary itself couldn't be resolved — every
      // other reason (unauthenticated, permissions, hangs, version-unsupported)
      // means the binary IS on PATH, just unusable for some other cause.
      // Collapsing all of these to 'missing' told operators a real, installed
      // CLI "wasn't there" when the actual fix was e.g. `codex login`.
      binary = unusableReason === 'not-on-path' ? 'missing' : 'resolved';
      version = binary === 'missing' ? 'n/a' : 'detected';
    } else {
      status = 'degraded';
      binary = 'resolved';
      version = 'detected';
    }

    cliHealthMap.set(cliId, { status, binary, version, probes: probesResults, ...(status === 'unusable' ? { reason } : {}) });
  }

  return cliHealthMap;
};