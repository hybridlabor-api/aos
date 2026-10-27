import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function computeHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function getSidecarPath(planPath) {
  const parsed = path.parse(planPath);
  const baseName = parsed.name;
  const dir = parsed.dir;
  return path.join(dir, `${baseName}.approval.json`);
}

export function verifyPlanApproval(planPath) {
  if (!planPath || typeof planPath !== 'string') {
    return { valid: false, hash: null, reason: 'No plan file specified' };
  }

  let content;
  try {
    content = fs.readFileSync(planPath, 'utf8');
  } catch (e) {
    return { valid: false, hash: null, reason: `Could not read plan file: ${e.message}` };
  }

  const contentHash = computeHash(content);
  const approvalPath = getSidecarPath(planPath);

  let approval;
  try {
    const raw = fs.readFileSync(approvalPath, 'utf8');
    approval = JSON.parse(raw);
  } catch (e) {
    return { valid: false, hash: contentHash, reason: `Could not read approval sidecar: ${e.message}` };
  }

  if (!approval || typeof approval !== 'object') {
    return { valid: false, hash: contentHash, reason: 'Approval sidecar is not a valid JSON object' };
  }

  if (approval.verdict !== 'approve') {
    return { valid: false, hash: contentHash, reason: 'Approval verdict is not "approve"' };
  }

  if (!approval.contentHash) {
    return { valid: false, hash: contentHash, reason: 'Approval sidecar missing contentHash field' };
  }

  if (approval.contentHash !== contentHash) {
    return { valid: false, hash: contentHash, reason: 'Plan content hash does not match approval record' };
  }

  return { valid: true, hash: contentHash, approval };
}
