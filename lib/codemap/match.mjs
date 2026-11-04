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
      const normalizedPath = file.path.replace(/\\/g, '/');

      // Next.js App Router & Pages Router
      const isAppRoute = normalizedPath.includes('/app/') && (normalizedPath.endsWith('route.ts') || normalizedPath.endsWith('route.js'));
      const isPagesRoute = normalizedPath.includes('/pages/api/') && !normalizedPath.includes('/_');

      if (isAppRoute || isPagesRoute) {
        if (isAppRoute) {
          const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
          for (const method of methods) {
            if (new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${method}\\b`).test(content)) {
              // Extract route starting from after 'app/'
              const parts = normalizedPath.split('/');
              const appIdx = parts.lastIndexOf('app');
              if (appIdx !== -1) {
                // Drop 'app/' prefix and '/route.{ts,js}' suffix
                let endpointPath = '/' + parts.slice(appIdx + 1, -1).join('/');
                endpoints.push({ path: endpointPath, method, file: file.path });
              }
            }
          }
        } else if (isPagesRoute) {
          // Extract route starting from 'api/' inside 'pages/'
          const parts = normalizedPath.split('/');
          const pagesIdx = parts.lastIndexOf('pages');
          if (pagesIdx !== -1) {
            let subPath = parts.slice(pagesIdx + 1).join('/'); // e.g., api/posts/index.js
            subPath = subPath.replace(/\.(js|ts)$/, '');
            if (subPath.endsWith('/index')) {
              subPath = subPath.slice(0, -6);
            }
            const endpointPath = '/' + subPath;
            // Pages router exports a default function handling all methods, unless explicitly checking req.method
            endpoints.push({ path: endpointPath, method: 'ALL', file: file.path });
          }
        }
      }

      // Express
      const expressPattern = /\bapp\.(get|post|put|delete|patch|all)\(['"`](.+?)['"`]/g;
      let match;
      while ((match = expressPattern.exec(content)) !== null) {
        endpoints.push({ path: match[2], method: match[1].toUpperCase(), file: file.path });
      }

      // Express Router mounts: app.use('/api', routerName)
      const routerUsePattern = /\bapp\.use\(['"`](.+?)['"`]\s*,\s*([a-zA-Z0-9_]+)\)/g;
      const routers = {}; // map of router variable name -> prefix
      while ((match = routerUsePattern.exec(content)) !== null) {
        routers[match[2]] = match[1];
      }

      // Look for require inline: app.use('/api', require('./routes'))
      const requireMountPattern = /\bapp\.use\(['"`](.+?)['"`]\s*,\s*require\(['"`](.+?)['"`]\)\)/g;
      const requiredMounts = [];
      while ((match = requireMountPattern.exec(content)) !== null) {
        requiredMounts.push({ prefix: match[1], routerPath: match[2], sourceFile: file.path });
      }

      // Look for inline ES module import map
      const esImportPattern = /import\s+([a-zA-Z0-9_]+)\s+from\s+['"`](.+?)['"`]/g;
      const esmImports = {};
      while ((match = esImportPattern.exec(content)) !== null) {
        esmImports[match[1]] = match[2]; // var name -> path
      }

      for (const [routerVar, prefix] of Object.entries(routers)) {
        if (esmImports[routerVar]) {
          requiredMounts.push({ prefix, routerPath: esmImports[routerVar], sourceFile: file.path });
        }
      }

      // Inline routers in the same file
      const routerMethods = /(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*express\.Router\(\)[\s\S]*?(?=(?:const|let|var|app|$))/g;
      let routerMatch;
      while ((routerMatch = routerMethods.exec(content)) !== null) {
        const routerName = routerMatch[1];
        const routerBlock = routerMatch[0];
        const prefix = routers[routerName] || '';

        const methodPattern = new RegExp(`\\b${routerName}\\.(get|post|put|delete|patch|all)\\(['"\`](.+?)['"\`]`, 'g');
        let m;
        while ((m = methodPattern.exec(routerBlock)) !== null) {
          endpoints.push({
            path: prefix + (m[2] === '/' ? '' : m[2]),
            method: m[1].toUpperCase(),
            file: file.path
          });
        }
      }

      // Search required router files
      for (const mount of requiredMounts) {
        // Build relative path check. Very simple naive resolution.
        // e.g. ./routes/auth.js -> routes/auth.js
        let cleanRouterPath = mount.routerPath;
        if (cleanRouterPath.startsWith('./')) {
          cleanRouterPath = cleanRouterPath.slice(2);
        }
        if (!cleanRouterPath.endsWith('.js') && !cleanRouterPath.endsWith('.ts')) {
          cleanRouterPath += '.js';
        }

        // Find file matching in files array relative to source file directory
        const dirParts = mount.sourceFile.split('/');
        dirParts.pop(); // remove filename
        const basePath = dirParts.join('/');

        // naive path join
        const expectedSuffix = basePath ? basePath + '/' + cleanRouterPath : cleanRouterPath;

        const routerFile = files.find(f => f.path.endsWith(expectedSuffix) || f.path.endsWith(cleanRouterPath));
        if (routerFile) {
          // It's a router file, find router.METHOD calls
          // Common patterns: router.get(), export default router, module.exports = router
          const methodPattern = /\b(router|app)\.(get|post|put|delete|patch|all)\(['"`](.+?)['"`]/g;
          let m;
          while ((m = methodPattern.exec(routerFile.content)) !== null) {
            endpoints.push({
              path: mount.prefix + (m[3] === '/' ? '' : m[3]),
              method: m[2].toUpperCase(),
              file: routerFile.path
            });
          }
        }
      }
    }

    if (ext === 'py') {
      // FastAPI / Flask
      // matches @app.get, @bp.route, @router.post, etc.
      const pyPattern = /@[a-zA-Z0-9_]+\.(get|post|put|delete|patch|route)\(["'](.+?)["'](?:[^)]*?methods\s*=\s*\[(.*?)\])?/gs;
      let match;
      while ((match = pyPattern.exec(content)) !== null) {
        let methods = [];
        if (match[1] === 'route') {
          if (match[3]) {
            // parse methods=['GET', 'POST']
            const methodStr = match[3];
            const mPattern = /['"]([A-Z]+)['"]/g;
            let m;
            while ((m = mPattern.exec(methodStr)) !== null) {
              methods.push(m[1]);
            }
          }
          if (methods.length === 0) methods = ['GET'];
        } else {
          methods = [match[1].toUpperCase()];
        }

        for (const m of methods) {
          endpoints.push({ path: match[2], method: m, file: file.path });
        }
      }
    }

    if (ext === 'go') {
      // Go net/http: http.HandleFunc, mux.HandleFunc, r.HandleFunc
      const goPattern = /[a-zA-Z0-9_]*\.?HandleFunc\(["'](.+?)["']/g;
      let match;
      while ((match = goPattern.exec(content)) !== null) {
        let routePattern = match[1];
        let method = 'ALL';

        // Go 1.22: "METHOD /path"
        const spaceIdx = routePattern.indexOf(' ');
        if (spaceIdx !== -1) {
          method = routePattern.slice(0, spaceIdx).toUpperCase();
          routePattern = routePattern.slice(spaceIdx + 1);
        }

        endpoints.push({ path: routePattern, method, file: file.path });
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
      const fetchPattern = /fetch\(['"`](.+?)['"`](?:[^)]*?method:\s*['"`]([A-Za-z]+)['"`])?/gs;
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

      const axiosDirectPattern = /axios\(['"`](.+?)['"`](?:[^)]*?method:\s*['"`]([A-Za-z]+)['"`])?/gs;
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
  // Flask: /<id> or /<int:id>
  // First escape all literal characters that have meaning in regex
  let regexStr = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Then apply parameters substitutions (we have to match the escaped brackets/braces)
  // Express: /:id
  regexStr = regexStr.replace(/\/:[a-zA-Z0-9_]+/g, '/[^/]+');
  // Next.js: /\[id\]
  regexStr = regexStr.replace(/\/\\\[[a-zA-Z0-9_]+\\\]/g, '/[^/]+');
  // FastAPI: /\{id\}
  regexStr = regexStr.replace(/\/\\\{[a-zA-Z0-9_]+\\\}/g, '/[^/]+');
  // Flask: /\<id\> or /\<int:id\>
  regexStr = regexStr.replace(/\/<[a-zA-Z0-9_:]+>/g, '/[^/]+');

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
