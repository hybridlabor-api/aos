'use strict';
// `npx -y pkg@x.y.z` keeps an `npm exec` wrapper (~40 MB) resident next to every server. The gateway installs each
// pinned package once into <gatewayDir>/mcp-pkgs and starts `node <bin entry>` directly. Anything unparsable or
// not installed stays on npx, so a failed install degrades to the old behaviour.
const fs = require('fs');
const path = require('path');

const SPEC = /^(@[a-z0-9._~-]+\/[a-z0-9._~-]+|[a-z0-9._~-]+)@(\d+\.\d+\.\d+[\w.-]*)$/i;
const pkgDirOf = (gatewayDir) => path.join(gatewayDir, 'mcp-pkgs');

// { name, version, rest } for `npx [-y|--yes ...] name@exact-version [args...]`, else null.
function parseNpx(cfg) {
    if (!cfg || !/^npx(\.cmd)?$/i.test(String(cfg.command)) || !Array.isArray(cfg.args)) return null;
    const i = cfg.args.findIndex((a) => !String(a).startsWith('-'));
    const m = i >= 0 ? SPEC.exec(String(cfg.args[i])) : null;
    return m ? { name: m[1], version: m[2], rest: cfg.args.slice(i + 1) } : null;
}

// Absolute path of the package's bin script when exactly this version is installed, else null.
function entryOf(pkgDir, { name, version }) {
    try {
        const root = path.join(pkgDir, 'node_modules', ...name.split('/'));
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (pkg.version !== version) return null;
        const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && (pkg.bin[name.split('/').pop()] || Object.values(pkg.bin)[0]));
        if (!bin) return null;
        const file = path.join(root, bin);
        return fs.existsSync(file) ? file : null;
    } catch { return null; }
}

// cfg with `node <entry>` in place of the npx call, or cfg itself when the package is not installed.
function pinNpx(cfg, pkgDir) {
    const p = pkgDir && parseNpx(cfg);
    const entry = p && entryOf(pkgDir, p);
    return entry ? { ...cfg, command: 'node', args: [entry, ...p.rest] } : cfg;
}

// name@version specs that are parsable but not yet installed.
function missingSpecs(servers, pkgDir) {
    const out = new Set();
    for (const cfg of Object.values(servers || {})) {
        const p = parseNpx(cfg);
        if (p && !entryOf(pkgDir, p)) out.add(`${p.name}@${p.version}`);
    }
    return [...out];
}

module.exports = { pkgDirOf, parseNpx, entryOf, pinNpx, missingSpecs };
