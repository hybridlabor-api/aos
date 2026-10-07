// A2A runtime deps (@a2a-js/sdk, express) are package.json dependencies, so bare imports
// resolve from the package checkout only. The installer's copies in ~/.agents/{lib,bin}
// have no node_modules beside them, so after npm i -g the sidecar and client fail there.
// The installer records the package root beside the copies (.aos-package-root.json); the
// resolver below falls back to requiring bare specifiers from that root. Nothing else
// changes: a git-checkout install resolves the bare imports directly.
// Both plumbing forms are needed: ./sdk/server/express builds the expressMod object via
// a2aImport, while echoExecutor-style lazy imports use a2aImport directly.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SDK_MISSING = "A2A SDK missing: install @hybridlabor-api/aos dependencies";

// The record lives beside this module: ~/.agents/lib/.aos-package-root.json in the installed
// layout, nowhere in a checkout (where the record does not exist and bare import already worked).
function recordedRoot() {
  try {
    const file = fileURLToPath(new URL(".aos-package-root.json", import.meta.url));
    const root = JSON.parse(readFileSync(file, "utf8")).packageRoot;
    if (typeof root === "string" && root && existsSync(join(root, "package.json"))) return root;
  } catch { /* no record beside this copy */ }
  return null;
}

// Bare specifier: node's ESM import first (checkout), then require() from the recorded package
// root (installed copy; the recorded package owns node_modules). The A2A SDK ships CJS builds
// for every subpath, so require() gives the same named exports the ESM import does.
export async function a2aImport(specifier) {
  try {
    return await import(specifier);
  } catch { /* fall through to the recorded package root */ }
  const root = recordedRoot();
  if (root) {
    try {
      return createRequire(pathToFileURL(join(root, "package.json")).href)(specifier);
    } catch { /* fall through */ }
  }
  throw new Error(SDK_MISSING);
}
