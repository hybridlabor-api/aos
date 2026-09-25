#!/usr/bin/env node
// AOS CLI -- the AOS dispatcher contract on top of the pi coding agent.
//
// What this is: a launcher. Everything it provides already exists --
//   * the AOS skills live in ~/.agents/skills, which the `aos` installer
//     writes and which pi discovers natively (Agent Skills spec);
//   * the 7-node dispatcher graph lives in ~/.agents/AGENTS.md.
//
// What this is not: a second copy of the AOS payload. It reads ~/.agents at
// runtime and never imports @hybridlabor-api/aos, so AOS CLI and the installer
// version and update independently. That is why pi updates are cheap here and
// AOS updates are cheap there.
//
//   aos-cli                      open the chat in the current directory
//   aos-cli "fix the failing go build"   same, with a first prompt
//   aos-cli --continue           resume the last session for this project
//   any other flag is handed to pi unchanged

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agents = path.join(os.homedir(), '.agents');

const args = ['--theme', path.join(root, 'themes', 'aos.json'), '--use-theme', 'aos'];

// pi discovers AGENTS.md from the working directory and its ancestors only, and
// ~/.agents/AGENTS.md is neither. Without this flag the dispatcher graph -- the
// one thing a bare pi genuinely cannot see -- is silently missing.
const dispatch = path.join(agents, 'AGENTS.md');
if (existsSync(dispatch)) {
    args.push('--append-system-prompt', dispatch);
} else {
    console.error('AOS CLI: ~/.agents not found -- run `npx @hybridlabor-api/aos` first.');
    console.error('         Starting without the AOS skills and the dispatcher graph.');
}

// Find pi's CLI entry by walking up to the package root that declares it.
// Neither require.resolve nor a fixed depth works: pi's `exports` map exports
// only its library entry, so `@earendil-works/pi-coding-agent/package.json`
// and `/dist/bundle/cli.js` both throw ERR_PACKAGE_PATH_NOT_EXPORTED, and
// npm leaves no node_modules/.bin/pi behind for a transitive dependency.
// The resolved import specifier points inside the package, so from there the
// root is at most a couple of levels up.
function findPiEntry(startDir) {
    let dir = startDir;
    for (;;) {
        const manifest = path.join(dir, 'package.json');
        if (existsSync(manifest)) {
            try {
                const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
                if (parsed.bin && parsed.bin.pi) return path.resolve(dir, parsed.bin.pi);
            } catch {
                // unreadable or malformed -- keep walking, a parent's manifest may still be pi's
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function piInvocation() {
    try {
        const entry = findPiEntry(
            path.dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')))
        );
        if (entry) return { command: process.execPath, prefix: [entry] };
    } catch {
        // pi is not installed next to us -- fall through to PATH
    }
    return { command: 'pi', prefix: [] };
}

const { command, prefix } = piInvocation();
const child = spawn(command, [...prefix, ...args, ...process.argv.slice(2)], { stdio: 'inherit' });

child.on('error', (err) => {
    console.error(`AOS CLI: cannot start pi (${err.code ?? err.message}).`);
    console.error('         Install it with: npm i -g @earendil-works/pi-coding-agent');
    process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
