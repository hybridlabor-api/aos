import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function findBestMatch(target, candidates) {
  if (candidates.length === 0) return null;
  let bestMatch = null;
  let minDistance = Infinity;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(target, candidate);
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = candidate;
    }
  }

  return minDistance <= 3 ? bestMatch : null;
}

export function validateCodeMap(map) {
  const errors = [];
  const partIds = new Set();
  const serviceIds = new Set();

  if (map.parts && Array.isArray(map.parts)) {
    for (const part of map.parts) {
      if (part.id) {
        partIds.add(part.id);
      }
    }
  }

  if (map.services && Array.isArray(map.services)) {
    for (const service of map.services) {
      if (service.id) {
        serviceIds.add(service.id);
      }
    }
  }

  const allKnownIds = [...partIds, ...serviceIds];

  const checkReference = (id, context) => {
    if (!partIds.has(id) && !serviceIds.has(id)) {
      const suggestion = findBestMatch(id, allKnownIds);
      let errorMsg = `Unknown part reference: '${id}' in ${context}.`;
      if (suggestion) {
        errorMsg += ` Did you mean '${suggestion}'?`;
      }
      errors.push(errorMsg);
    }
  };

  if (map.parts && Array.isArray(map.parts)) {
    for (const part of map.parts) {
      if (part.parent) {
        checkReference(part.parent, `part '${part.id}' parent`);
      }
    }
  }

  if (map.connections && Array.isArray(map.connections)) {
    for (let i = 0; i < map.connections.length; i++) {
      const conn = map.connections[i];
      if (conn.from) {
        checkReference(conn.from, `connections[${i}].from`);
      }
      if (conn.to) {
        checkReference(conn.to, `connections[${i}].to`);
      }
    }
  }

  if (map.flows && Array.isArray(map.flows)) {
    for (let i = 0; i < map.flows.length; i++) {
      const flow = map.flows[i];
      if (flow.steps && Array.isArray(flow.steps)) {
        for (let j = 0; j < flow.steps.length; j++) {
          const step = flow.steps[j];
          if (step.part) {
            checkReference(step.part, `flows[${i}].steps[${j}].part`);
          }
        }
      }
    }
  }

  return errors;
}
