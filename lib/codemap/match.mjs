import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Extracts endpoints from server files.
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, method: string, file: string}>}
 */
export function extractEndpoints(files) {
  const endpoints = [];

  for (const file of files) {
    const content = file.content;
    const ext = file.path.split('.').pop();

    if (['js', 'ts'].includes(ext)) {
      // Next.js App Router
      const normalizedPath = file.path.replace(/\\/g, '/');
      if (normalizedPath.includes('/app/api/') && normalizedPath.endsWith('route.ts')) {
        const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
        for (const method of methods) {
          if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(content)) {
            // Reconstruct path from directory structure
            // e.g., app/api/users/[id]/route.ts -> /api/users/[id]
            const parts = normalizedPath.split('/');
            const apiIdx = parts.indexOf('api');
            if (apiIdx !== -1) {
              const endpointPath = '/' + parts.slice(apiIdx, -1).join('/');
              endpoints.push({ path: endpointPath, method, file: file.path });
            }
          }
        }
      }

      // Express
      const expressPattern = /app\.(get|post|put|delete|patch|all)\(['"`](.+?)['"`]/g;
      let match;
      while ((match = expressPattern.exec(content)) !== null) {
        endpoints.push({ path: match[2], method: match[1].toUpperCase(), file: file.path });
      }

      // Express Router mounts
      const routerUsePattern = /app\.use\(['"`](.+?)['"`]\s*,\s*([a-zA-Z0-9_]+)\)/g;
      const routers = {};
      while ((match = routerUsePattern.exec(content)) !== null) {
        routers[match[2]] = match[1];
      }

      const routerMethods = /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*express\.Router\(\)[\s\S]*?(?=(?:const|let|var|app|$))/g;
      let routerMatch;
      while ((routerMatch = routerMethods.exec(content)) !== null) {
        const routerName = routerMatch[1];
        const routerBlock = routerMatch[0];
        const prefix = routers[routerName] || '';

        const methodPattern = new RegExp(`${routerName}\\.(get|post|put|delete|patch|all)\\(['"\`](.+?)['"\`]`, 'g');
        let m;
        while ((m = methodPattern.exec(routerBlock)) !== null) {
          endpoints.push({
            path: prefix + (m[2] === '/' ? '' : m[2]),
            method: m[1].toUpperCase(),
            file: file.path
          });
        }
      }
    }

    if (ext === 'py') {
      // FastAPI / Flask
      const pyPattern = /@app\.(get|post|put|delete|patch|route)\(["'](.+?)["']/g;
      let match;
      while ((match = pyPattern.exec(content)) !== null) {
        const method = match[1] === 'route' ? 'GET' : match[1].toUpperCase();
        endpoints.push({ path: match[2], method, file: file.path });
      }
    }

    if (ext === 'go') {
      // Go net/http
      const goPattern = /http\.HandleFunc\(["'](.+?)["']/g;
      let match;
      while ((match = goPattern.exec(content)) !== null) {
        endpoints.push({ path: match[1], method: 'ALL', file: file.path });
      }
    }
  }

  return endpoints;
}

/**
 * Extracts client requests from files.
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, method: string, file: string}>}
 */
export function extractRequests(files) {
  const requests = [];

  for (const file of files) {
    const content = file.content;
    const ext = file.path.split('.').pop();

    if (['js', 'ts', 'jsx', 'tsx'].includes(ext)) {
      // fetch('/api/path') or fetch('/api/path', { method: 'POST' })
      const fetchPattern = /fetch\(['"`](.+?)['"`](?:.*?method:\s*['"`]([A-Za-z]+)['"`])?/g;
      let match;
      while ((match = fetchPattern.exec(content)) !== null) {
        requests.push({
          path: match[1],
          method: (match[2] || 'GET').toUpperCase(),
          file: file.path
        });
      }

      // axios.get('/api/path') or axios('/api/path')
      const axiosPattern = /axios\.(get|post|put|delete|patch|head|options)\(['"`](.+?)['"`]/g;
      while ((match = axiosPattern.exec(content)) !== null) {
        requests.push({
          path: match[2],
          method: match[1].toUpperCase(),
          file: file.path
        });
      }

      const axiosDirectPattern = /axios\(['"`](.+?)['"`](?:.*?method:\s*['"`]([A-Za-z]+)['"`])?/g;
      while ((match = axiosDirectPattern.exec(content)) !== null) {
        requests.push({
          path: match[1],
          method: (match[2] || 'GET').toUpperCase(),
          file: file.path
        });
      }
    }
  }

  return requests;
}

/**
 * Normalizes an endpoint path to a RegExp to match incoming request paths.
 * @param {string} path
 * @returns {RegExp}
 */
export function normalizeEndpointPath(path) {
  // Convert parameter syntaxes to regex:
  // Express: /:id
  // Next.js/FastAPI: /[id] or /{id}
  // Flask: /<id>
  let regexStr = path
    .replace(/\/:[a-zA-Z0-9_]+/g, '/[^/]+')
    .replace(/\/\[[a-zA-Z0-9_]+\]/g, '/[^/]+')
    .replace(/\/{[a-zA-Z0-9_]+}/g, '/[^/]+')
    .replace(/\/<[a-zA-Z0-9_]+>/g, '/[^/]+');

  // Go prefix match: trailing slash matches any subpath
  if (regexStr.endsWith('/') && regexStr.length > 1) {
    regexStr = regexStr + '.*';
  }

  // Ensure we match the whole string or up to a query string
  return new RegExp(`^${regexStr}(\\?.*)?$`);
}

/**
 * Main function to match requests.
 * @param {Array<{path: string, content: string}>} files
 */
export function matchRequests(files) {
  const endpoints = extractEndpoints(files);
  const requests = extractRequests(files);

  const matches = [];
  const unmatchedRequests = [];

  for (const req of requests) {
    let matched = false;
    for (const ep of endpoints) {
      if (ep.method === 'ALL' || ep.method === req.method) {
        const pattern = normalizeEndpointPath(ep.path);
        if (pattern.test(req.path)) {
          matches.push({ request: req, endpoint: ep });
          matched = true;
          break; // Stop after first match for a request
        }
      }
    }

    if (!matched) {
      unmatchedRequests.push(req);
    }
  }

  return { endpoints, requests, matches, unmatchedRequests };
}
