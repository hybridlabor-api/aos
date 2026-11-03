import fs from 'fs';

const schemaPath = new URL('./schema.json', import.meta.url);
const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

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

  const maxAllowedDistance = Math.max(1, Math.floor(target.length / 3));
  return minDistance <= maxAllowedDistance ? bestMatch : null;
}

export function validateCodeMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return ['CodeMap must be an object.'];
  }

  const errors = [];
  const partIds = new Set();
  const serviceIds = new Set();

  if (map.parts !== undefined) {
    if (!Array.isArray(map.parts)) {
      errors.push("Property 'parts' must be an array.");
    } else {
      for (let i = 0; i < map.parts.length; i++) {
        const part = map.parts[i];
        if (!part || typeof part !== 'object') {
          errors.push(`parts[${i}] must be an object.`);
          continue;
        }
        if (typeof part.id !== 'string') {
          errors.push(`parts[${i}] must have a string 'id'.`);
        } else if (partIds.has(part.id)) {
          errors.push(`Duplicate part id: '${part.id}'`);
        } else {
          partIds.add(part.id);
        }
        if (typeof part.name !== 'string') {
          errors.push(`parts[${i}] must have a string 'name'.`);
        }
        if (part.globs !== undefined && !Array.isArray(part.globs)) {
          errors.push(`parts[${i}].globs must be an array of strings.`);
        }
      }
    }
  }

  if (map.services !== undefined) {
    if (!Array.isArray(map.services)) {
      errors.push("Property 'services' must be an array.");
    } else {
      for (let i = 0; i < map.services.length; i++) {
        const service = map.services[i];
        if (!service || typeof service !== 'object') {
          errors.push(`services[${i}] must be an object.`);
          continue;
        }
        if (typeof service.id !== 'string') {
          errors.push(`services[${i}] must have a string 'id'.`);
        } else if (serviceIds.has(service.id) || partIds.has(service.id)) {
          errors.push(`Duplicate service id: '${service.id}'`);
        } else {
          serviceIds.add(service.id);
        }
        if (typeof service.name !== 'string') {
          errors.push(`services[${i}] must have a string 'name'.`);
        }
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

  if (map.flows !== undefined) {
    if (!Array.isArray(map.flows)) {
      errors.push("Property 'flows' must be an array.");
    } else {
      for (let i = 0; i < map.flows.length; i++) {
        const flow = map.flows[i];
        if (!flow || typeof flow !== 'object') {
          errors.push(`flows[${i}] must be an object.`);
          continue;
        }
        if (typeof flow.id !== 'string') {
          errors.push(`flows[${i}] must have a string 'id'.`);
        }
        if (typeof flow.name !== 'string') {
          errors.push(`flows[${i}] must have a string 'name'.`);
        }
        if (!Array.isArray(flow.steps)) {
          errors.push(`flows[${i}].steps must be an array.`);
        } else {
          for (let j = 0; j < flow.steps.length; j++) {
            const step = flow.steps[j];
            if (!step || typeof step !== 'object') {
              errors.push(`flows[${i}].steps[${j}] must be an object.`);
              continue;
            }
            if (typeof step.part !== 'string') {
              errors.push(`flows[${i}].steps[${j}] must have a string 'part'.`);
            } else {
              checkReference(step.part, `flows[${i}].steps[${j}].part`);
            }
          }
        }
      }
    }
  }

  if (map.tour !== undefined) {
    if (!Array.isArray(map.tour)) {
      errors.push("Property 'tour' must be an array.");
    } else {
      for (let i = 0; i < map.tour.length; i++) {
        const item = map.tour[i];
        if (!item || typeof item !== 'object') {
          errors.push(`tour[${i}] must be an object.`);
          continue;
        }
        if (typeof item.part !== 'string') {
          errors.push(`tour[${i}] must have a string 'part'.`);
        } else {
          checkReference(item.part, `tour[${i}].part`);
        }
      }
    }
  }

  return errors;
}
