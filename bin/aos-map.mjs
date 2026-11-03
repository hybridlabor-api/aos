#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h' || args.includes('--help') || args.includes('-h')) {
    if (args.includes('--json')) {
        console.log(JSON.stringify({
            name: "aos-map",
            summary: "Codemap query CLI for architectural overview, node finding, and pathfinding.",
            usage: ["aos-map overview", "aos-map find <text>", "aos-map show <part|file>", "aos-map path <a> <b>"]
        }));
    } else {
        console.log(`
Usage:
  aos-map overview
  aos-map find <text>
  aos-map show <part|file>
  aos-map path <a> <b>
`);
    }
    process.exit(0);
}

function loadMap() {
    const mapPath = path.join(process.cwd(), '.aos/map/architecture.json');
    if (!fs.existsSync(mapPath)) {
        console.error('No .aos/map/architecture.json found');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
}

if (command === 'overview') {
    const map = loadMap();
    const parts = map.parts || [];
    const connections = map.connections || [];
    console.log(`Map: ${parts.length} parts, ${connections.length} connections`);
    for (const part of parts) {
        const id = part.id || 'unknown';
        const name = part.name || 'unnamed';
        const summary = part.summary || 'no summary';
        console.log(`${id} - ${name} - ${summary}`);
    }
} else if (command === 'find') {
    const text = args[1];
    if (!text) {
        console.error('Missing text');
        process.exit(1);
    }
    const map = loadMap();
    const parts = map.parts || [];
    const search = text.toLowerCase();
    let found = false;
    for (const part of parts) {
        const id = (part.id || '').toLowerCase();
        const name = (part.name || '').toLowerCase();
        const summary = (part.summary || '').toLowerCase();
        const globs = Array.isArray(part.globs) ? part.globs.join(' ').toLowerCase() : (part.globs || '').toLowerCase();

        if (id.includes(search) || name.includes(search) || summary.includes(search) || globs.includes(search)) {
            console.log(`${part.id || 'unknown'} - ${part.name || 'unnamed'} - ${part.summary || 'no summary'}`);
            found = true;
        }
    }
    if (!found) {
        process.exit(1);
    }
} else if (command === 'show') {
    const query = args[1];
    if (!query) {
        console.error('Missing part');
        process.exit(1);
    }
    const map = loadMap();
    const parts = map.parts || [];

    let foundPart = null;
    for (const part of parts) {
        if (part.id === query) {
            foundPart = part;
            break;
        }
        if (part.globs) {
            const globsList = Array.isArray(part.globs) ? part.globs : [part.globs];
            if (globsList.includes(query) || globsList.some(g => g.includes(query))) {
                foundPart = part;
                break;
            }
        }
    }

    if (foundPart) {
        console.log(`${foundPart.id || 'unknown'} - ${foundPart.name || 'unnamed'} - ${foundPart.summary || 'no summary'}`);
        if (foundPart.globs) {
            console.log(`Globs: ${Array.isArray(foundPart.globs) ? foundPart.globs.join(', ') : foundPart.globs}`);
        }
        if (foundPart.parent) {
            console.log(`Parent: ${foundPart.parent}`);
        }
        if (foundPart.blueprint) {
            console.log(`Blueprint: ${foundPart.blueprint}`);
        }
    } else {
        process.exit(1);
    }
} else if (command === 'path') {
    const a = args[1];
    const b = args[2];
    if (!a || !b) {
        console.error('Missing path arguments');
        process.exit(1);
    }
    const map = loadMap();
    const connections = map.connections || [];

    // Find path using BFS
    const adj = {};
    for (const conn of connections) {
        if (!adj[conn.from]) adj[conn.from] = [];
        adj[conn.from].push(conn.to);
    }

    const queue = [[a]];
    const visited = new Set([a]);
    let pathFound = null;

    while (queue.length > 0) {
        const p = queue.shift();
        const node = p[p.length - 1];

        if (node === b) {
            pathFound = p;
            break;
        }

        if (adj[node]) {
            for (const neighbor of adj[node]) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push([...p, neighbor]);
                }
            }
        }
    }

    if (pathFound) {
        console.log(`Path from ${a} to ${b}: ${pathFound.join(' -> ')}`);
    } else {
        console.error(`No path from ${a} to ${b}`);
        process.exit(1);
    }
} else {
    console.error('Unknown command');
    process.exit(1);
}
