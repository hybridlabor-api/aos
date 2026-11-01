const fs = require('fs');
let code = fs.readFileSync('mcps/RhinoMCP/shared/router-launcher.mjs', 'utf8');

code = code.replace(
    /function resolveRid\(\) \{\n  if \(process\.platform === "darwin"\) return "osx-arm64";/,
    `function resolveRid() {\n  if (process.platform === "darwin") return process.arch === "x64" ? "osx-x64" : "osx-arm64";`
);

code = code.replace(
    /const base = join\(root, ver, "Rhino-MCP-Platform"\);\n    if \(!isDir\(base\)\) continue;\n    for \(const pkgver of listDirs\(base\)\.sort\(byVersionDesc\)\) \{\n      considered\.push\(\{ ver, pkgver, path: join\(base, pkgver, "router", rid, exe\) \}\);\n    \}/,
    `for (const pluginName of ["rhinoai", "Rhino-MCP-Platform"]) {
      const base = join(root, ver, pluginName);
      if (!isDir(base)) continue;
      for (const pkgver of listDirs(base).sort(byVersionDesc)) {
        considered.push({ ver, pkgver, path: join(base, pkgver, "router", rid, exe) });
      }
    }`
);

fs.writeFileSync('mcps/RhinoMCP/shared/router-launcher.mjs', code);
