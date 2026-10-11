'use strict';
// Compatibility shim: WP1 keeps all core+plans routes in routes-plans.mjs
// (the task's fixed file list has no separate core-routes module).
export { routes, TRAIL_PORTS, probeTrailPorts, normalizeSessions } from './routes-plans.mjs';
