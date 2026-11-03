#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function loadMap() {
    const mapPath = path.join(process.cwd(), '.aos/map/architecture.json');
    if (!fs.existsSync(mapPath)) {
        console.error('No .aos/map/architecture.json found');
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'overview') {
    const map = loadMap();
    console.log(JSON.stringify(map, null, 2));
} else if (command === 'find') {
    const text = args[1];
    if (!text) {
        console.error('Missing text');
        process.exit(1);
    }
    const map = loadMap();
    let found = false;
    for (const [key, value] of Object.entries(map)) {
        if (JSON.stringify(value).includes(text)) {
            console.log(`${key}: ${JSON.stringify(value)}`);
            found = true;
        }
    }
    if (!found) {
        process.exit(1);
    }
} else if (command === 'show') {
    const part = args[1];
    if (!part) {
        console.error('Missing part');
        process.exit(1);
    }
    const map = loadMap();
    if (map[part]) {
        console.log(JSON.stringify(map[part], null, 2));
    } else {
        let foundNode = null;
        if (Array.isArray(map.nodes)) {
             foundNode = map.nodes.find(n => n.id === part || (n.file && n.file === part));
        }
        if (foundNode) {
            console.log(JSON.stringify(foundNode, null, 2));
        } else {
            process.exit(1);
        }
    }
} else if (command === 'path') {
    const a = args[1];
    const b = args[2];
    if (!a || !b) {
        console.error('Missing path arguments');
        process.exit(1);
    }
    const map = loadMap();
    const edges = map.edges || [];

    // Find path using BFS
    const adj = {};
    for (const edge of edges) {
        if (!adj[edge.source]) adj[edge.source] = [];
        adj[edge.source].push(edge.target);
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
